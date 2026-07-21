import webPush from "web-push";

import { privateApiHeaders, SinkConfigurationError, SinkRequestError } from "./sink.js";
import { notificationEligible } from "./verify.js";
import type {
  PushReservation,
  PushSubscriptionTarget,
  VerifiedObservation,
} from "./types.js";

export interface PushConfig {
  baseUrl: string;
  deliverySecret: string;
  sitesAuthToken?: string;
  vapidSubject: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  timeoutMs?: number;
}

export interface PushDeliverySummary {
  eligible: boolean;
  targets: number;
  reserved: number;
  sent: number;
  failed: number;
}

interface TargetResponse {
  ok: boolean;
  targets: PushSubscriptionTarget[];
  nextAfter: number | null;
}

type DeliveryAction =
  | { action: "reserve"; alertId: string; subscriptionId: number }
  | { action: "complete"; reservationId: number; status: "sent" | "failed"; errorCode?: string };

function apiEndpoint(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  if ((base.protocol !== "https:" && !(local && base.protocol === "http:")) || base.username || base.password) {
    throw new SinkConfigurationError("PRICE_RADAR_BASE_URL invalide pour le push.");
  }
  base.pathname = "/";
  base.search = "";
  base.hash = "";
  return new URL(path, base);
}

function pushHeaders(config: PushConfig): Record<string, string> {
  if (!config.deliverySecret.trim()) {
    throw new SinkConfigurationError("PUSH_DELIVERY_SECRET absent: push désactivé.");
  }
  return privateApiHeaders({
    secret: config.deliverySecret,
    ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
  });
}

async function protectedJson<T>(
  config: PushConfig,
  endpoint: URL,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15_000);
  try {
    const response = await fetchImpl(endpoint, {
      ...init,
      headers: pushHeaders(config),
      signal: controller.signal,
    });
    if (!response.ok) throw new SinkRequestError(`API push refusée (HTTP ${response.status}).`, response.status);
    return await response.json() as T;
  } catch (error) {
    if (error instanceof SinkRequestError || error instanceof SinkConfigurationError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SinkRequestError("Délai API push dépassé.", null);
    }
    throw new SinkRequestError("Échec réseau API push.", null);
  } finally {
    clearTimeout(timeout);
  }
}

function validTarget(value: unknown): value is PushSubscriptionTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Partial<PushSubscriptionTarget>;
  if (!Number.isSafeInteger(target.id) || (target.id ?? 0) < 1 || typeof target.endpoint !== "string" || !target.keys) return false;
  if (typeof target.keys.p256dh !== "string" || typeof target.keys.auth !== "string") return false;
  try {
    const endpoint = new URL(target.endpoint);
    return endpoint.protocol === "https:" && !endpoint.username && !endpoint.password;
  } catch {
    return false;
  }
}

export async function fetchPushTargets(
  score: number,
  config: PushConfig,
  fetchImpl: typeof fetch = fetch,
  filters?: {
    discount: number;
    priceCents: number;
    source: string;
    market: string;
    category: string;
    deliveryCountry?: string;
    deliveryPostalPrefix?: string;
    deliveryMode?: string;
    locationVerified?: boolean;
  },
): Promise<PushSubscriptionTarget[]> {
  const targets: PushSubscriptionTarget[] = [];
  let after = 0;
  for (let page = 0; page < 10; page += 1) {
    const endpoint = apiEndpoint(config.baseUrl, "api/push/targets");
    endpoint.search = new URLSearchParams({
      score: String(Math.max(0, Math.min(100, Math.round(score)))),
      limit: "500",
      after: String(after),
      ...(filters ? {
        discount: String(Math.max(0, Math.round(filters.discount))),
        priceCents: String(Math.max(0, Math.round(filters.priceCents))),
        source: filters.source,
        market: filters.market,
        category: filters.category,
        deliveryCountry: filters.deliveryCountry ?? "",
        deliveryPostalPrefix: filters.deliveryPostalPrefix ?? "",
        deliveryMode: filters.deliveryMode ?? "",
        locationVerified: String(filters.locationVerified === true),
      } : {}),
    }).toString();
    const payload = await protectedJson<TargetResponse>(config, endpoint, { method: "GET" }, fetchImpl);
    if (!payload.ok || !Array.isArray(payload.targets)) {
      throw new SinkRequestError("Réponse des cibles push invalide.", null);
    }
    targets.push(...payload.targets.filter(validTarget));
    if (!Number.isSafeInteger(payload.nextAfter) || payload.nextAfter === null || payload.nextAfter <= after) break;
    after = payload.nextAfter;
  }
  return targets;
}

async function deliveryAction(
  action: DeliveryAction,
  config: PushConfig,
  fetchImpl: typeof fetch,
): Promise<PushReservation> {
  const endpoint = apiEndpoint(config.baseUrl, "api/push/deliveries");
  return protectedJson<PushReservation>(config, endpoint, {
    method: "POST",
    body: JSON.stringify(action),
  }, fetchImpl);
}

function deliveryErrorCode(error: unknown): string {
  const status = typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : null;
  if (status === 404) return "PUSH_404";
  if (status === 410) return "PUSH_410";
  if (status === 413) return "PUSH_413";
  if (status !== null && Number.isFinite(status)) return `PUSH_HTTP_${status}`;
  return "PUSH_FAILED";
}

export async function sendPushForObservation(
  alertId: string,
  backendScore: number,
  observation: VerifiedObservation,
  config: PushConfig,
  dependencies: {
    fetchImpl?: typeof fetch;
    sendNotification?: typeof webPush.sendNotification;
  } = {},
): Promise<PushDeliverySummary> {
  if (!notificationEligible(observation)) {
    return { eligible: false, targets: 0, reserved: 0, sent: 0, failed: 0 };
  }
  if (!config.vapidSubject || !config.vapidPublicKey || !config.vapidPrivateKey) {
    throw new SinkConfigurationError("Clés VAPID absentes: notifications désactivées.");
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  if (!dependencies.sendNotification) {
    webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  }
  const targets = await fetchPushTargets(backendScore, config, fetchImpl, {
    discount: observation.anomaly.discountPercent ?? 0,
    priceCents: observation.offer.total?.amountMinor ?? observation.offer.price.amountMinor,
    source: observation.offer.product.source,
    market: observation.offer.product.market,
    category: observation.offer.product.category ?? "",
    deliveryCountry: observation.offer.deliveryContext?.country ?? "",
    deliveryPostalPrefix: observation.offer.deliveryContext?.postalPrefix ?? "",
    deliveryMode: observation.offer.deliveryContext?.mode ?? "",
    locationVerified: observation.offer.deliveryContext?.verified === true,
  });
  const summary: PushDeliverySummary = { eligible: true, targets: targets.length, reserved: 0, sent: 0, failed: 0 };
  const total = observation.offer.total;
  if (total === null) return { eligible: false, targets: 0, reserved: 0, sent: 0, failed: 0 };
  const payload = JSON.stringify({
    alertId,
    title: `PrixRadar · ${observation.offer.product.title}`,
    body: `${(total.amountMinor / 100).toFixed(2)} ${total.currency} · score ${backendScore}/100`,
    url: observation.offer.product.url,
    source: observation.offer.product.source,
    market: observation.offer.product.market,
  });

  for (const target of targets) {
    const reservation = await deliveryAction({
      action: "reserve",
      alertId,
      subscriptionId: target.id,
    }, config, fetchImpl);
    if (!reservation.ok || !reservation.reserved || !reservation.reservationId) continue;
    summary.reserved += 1;

    try {
      await (dependencies.sendNotification ?? webPush.sendNotification)({
        endpoint: target.endpoint,
        keys: target.keys,
      }, payload, {
        TTL: 900,
        urgency: "high",
        topic: alertId.slice(0, 32),
        ...(target.contentEncoding === "aesgcm" || target.contentEncoding === "aes128gcm"
          ? { contentEncoding: target.contentEncoding }
          : {}),
      });
      await deliveryAction({
        action: "complete",
        reservationId: reservation.reservationId,
        status: "sent",
      }, config, fetchImpl);
      summary.sent += 1;
    } catch (error) {
      await deliveryAction({
        action: "complete",
        reservationId: reservation.reservationId,
        status: "failed",
        errorCode: deliveryErrorCode(error),
      }, config, fetchImpl);
      summary.failed += 1;
    }
  }
  return summary;
}
