import webPush from "web-push";

import { privateApiHeaders, SinkConfigurationError, SinkRequestError } from "./sink.js";
import { logger } from "./logger.js";
import { hasExactVariantEvidence, notificationEligible } from "./verify.js";
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

interface DigestTarget extends PushSubscriptionTarget {
  alertId: string;
  title: string;
  body: string;
  url: string;
}

interface ProtectionTarget extends PushSubscriptionTarget {
  notificationId: number;
  purchaseId: string;
  title: string;
  body: string;
  url: string;
}

interface SocialTarget extends PushSubscriptionTarget {
  notificationId: number;
  attemptId: string;
  publicationId: string;
  title: string;
  body: string;
  url: string;
  imageUrl: string | null;
}

type DeliveryAction =
  | { action: "reserve"; alertId: string; subscriptionId: number; tier?: "urgent" | "personal" | "digest"; alertLevel?: "reliable" | "watch" }
  | { action: "complete"; reservationId: number; status: "sent" | "failed"; errorCode?: string };

function base64Url(value: string): string {
  return value.trim().replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function pushTopic(value: string): string {
  const safe = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
  return (safe || "prixradar").slice(0, 32);
}

function configureVapid(config: PushConfig): void {
  webPush.setVapidDetails(
    config.vapidSubject,
    base64Url(config.vapidPublicKey),
    base64Url(config.vapidPrivateKey),
  );
}

function normalizedSubscription(target: PushSubscriptionTarget) {
  return {
    endpoint: target.endpoint,
    keys: {
      p256dh: base64Url(target.keys.p256dh),
      auth: base64Url(target.keys.auth),
    },
  };
}

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
    title: string;
    brand?: string | null;
    gtin?: string | null;
    condition?: string | null;
    accessibleToAll: boolean;
    sellerScore: number;
    exactVariantConfirmed: boolean;
    cartConfirmed: boolean;
    historyPoints: number;
    verifiedAgeMinutes: number;
    tier: "urgent" | "personal";
    alertLevel: "reliable" | "watch";
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
        title: filters.title,
        brand: filters.brand ?? "",
        gtin: filters.gtin ?? "",
        condition: filters.condition ?? "",
        accessibleToAll: String(filters.accessibleToAll),
        sellerScore: String(Math.max(0, Math.min(100, Math.round(filters.sellerScore)))),
        exactVariantConfirmed: String(filters.exactVariantConfirmed),
        cartConfirmed: String(filters.cartConfirmed),
        historyPoints: String(Math.max(0, Math.min(1_000, Math.round(filters.historyPoints)))),
        verifiedAgeMinutes: String(Math.max(0, Math.min(10_080, Math.round(filters.verifiedAgeMinutes)))),
        tier: filters.tier,
        alertLevel: filters.alertLevel,
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
  options: { alertLevel?: "reliable" | "watch" } = {},
): Promise<PushDeliverySummary> {
  const alertLevel = options.alertLevel === "watch" ? "watch" as const : "reliable" as const;
  const categoryListingWatchEligible = observation.offer.fixture === false
    && observation.offer.product.source === "jd_sports"
    && observation.offer.verificationScope === "category_listing"
    && hasExactVariantEvidence(observation.offer)
    && observation.offer.availability === "in_stock"
    && observation.offer.condition === "new"
    && observation.offer.sellerTrusted
    && observation.offer.seller === "JD Sports"
    && observation.offer.promotion?.accessibleToAll !== false
    && (observation.anomaly.discountPercent ?? 0) >= 70;
  const broadWatchEligible = observation.offer.fixture === false
    && hasExactVariantEvidence(observation.offer)
    && observation.offer.availability === "in_stock"
    && observation.offer.promotion?.accessibleToAll !== false
    && observation.offer.seller !== null
    && (observation.anomaly.discountPercent ?? 0) >= 20
    && observation.anomaly.score >= 35;
  const watchEligible = categoryListingWatchEligible || broadWatchEligible;
  if ((alertLevel === "reliable" && !notificationEligible(observation)) || (alertLevel === "watch" && !watchEligible)) {
    return { eligible: false, targets: 0, reserved: 0, sent: 0, failed: 0 };
  }
  if (!config.vapidSubject || !config.vapidPublicKey || !config.vapidPrivateKey) {
    throw new SinkConfigurationError("Clés VAPID absentes: notifications désactivées.");
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  if (!dependencies.sendNotification) {
    configureVapid(config);
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
    title: observation.offer.product.title,
    brand: observation.offer.product.brand,
    gtin: observation.offer.product.gtin,
    condition: observation.offer.condition,
    accessibleToAll: observation.offer.promotion?.accessibleToAll !== false,
    sellerScore: observation.offer.sellerTrusted ? 100 : 0,
    exactVariantConfirmed: hasExactVariantEvidence(observation.offer),
    cartConfirmed: observation.offer.cartProbe?.status === "confirmed"
      && observation.offer.cartProbe.identityConfirmed
      && observation.offer.cartProbe.explicitShipping
      && observation.offer.cartProbe.explicitTotal
      && observation.offer.cartProbe.couponApplied
      && observation.offer.cartProbe.totalCents !== null,
    historyPoints: observation.historicalPrices?.length ?? 0,
    verifiedAgeMinutes: Math.max(0, (Date.now() - Date.parse(observation.verification.secondObservedAt)) / 60_000),
    tier: backendScore >= 88 && (observation.anomaly.discountPercent ?? 0) >= 35 ? "urgent" : "personal",
    alertLevel,
  });
  const summary: PushDeliverySummary = { eligible: true, targets: targets.length, reserved: 0, sent: 0, failed: 0 };
  const total = observation.offer.total ?? observation.offer.price;
  const listingOnly = observation.offer.verificationScope === "category_listing";
  const payload = JSON.stringify({
    alertId,
    title: `${alertLevel === "watch" ? "Prix à vérifier" : "PrixRadar"} · ${observation.offer.product.title}`,
    body: listingOnly
      ? `${(total.amountMinor / 100).toFixed(2)} ${total.currency} · baisse de ${Math.round(observation.anomaly.discountPercent ?? 0)} %, taille, stock et livraison à confirmer`
      : `${(total.amountMinor / 100).toFixed(2)} ${total.currency} · ${alertLevel === "watch" ? "baisse inhabituelle, vendeur à contrôler" : `score ${backendScore}/100`}`,
    url: `/?alert=${encodeURIComponent(alertId)}`,
    externalUrl: observation.offer.product.url,
    source: observation.offer.product.source,
    market: observation.offer.product.market,
    tier: backendScore >= 88 && (observation.anomaly.discountPercent ?? 0) >= 35 ? "urgent" : "personal",
    alertLevel,
    badgeCount: 1,
  });

  for (const target of targets) {
    const reservation = await deliveryAction({
      action: "reserve",
      alertId,
      subscriptionId: target.id,
      tier: target.tier ?? "personal",
      alertLevel,
    }, config, fetchImpl);
    if (!reservation.ok || !reservation.reserved || !reservation.reservationId) continue;
    summary.reserved += 1;

    try {
      await (dependencies.sendNotification ?? webPush.sendNotification)(normalizedSubscription(target), payload, {
        TTL: 900,
        urgency: target.tier === "urgent" ? "high" : "normal",
        topic: pushTopic(alertId),
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
      const errorCode = deliveryErrorCode(error);
      logger.warn("push_send_failed", {
        alertId,
        subscriptionId: target.id,
        errorCode,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message.slice(0, 240) : "Erreur push inconnue",
        statusCode: typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode?: unknown }).statusCode)
          : null,
      });
      await deliveryAction({
        action: "complete",
        reservationId: reservation.reservationId,
        status: "failed",
        errorCode,
      }, config, fetchImpl);
      summary.failed += 1;
    }
  }
  return summary;
}

export async function sendDailyDigests(
  config: PushConfig,
  dependencies: { fetchImpl?: typeof fetch; sendNotification?: typeof webPush.sendNotification } = {},
): Promise<PushDeliverySummary> {
  if (!config.vapidSubject || !config.vapidPublicKey || !config.vapidPrivateKey) {
    throw new SinkConfigurationError("Clés VAPID absentes: résumés désactivés.");
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  if (!dependencies.sendNotification) configureVapid(config);
  const endpoint = apiEndpoint(config.baseUrl, "api/push/digests");
  const response = await protectedJson<{ ok: boolean; targets?: DigestTarget[] }>(config, endpoint, { method: "GET" }, fetchImpl);
  const targets = Array.isArray(response.targets) ? response.targets.filter((target) => validTarget(target) && typeof target.alertId === "string") : [];
  const summary: PushDeliverySummary = { eligible: targets.length > 0, targets: targets.length, reserved: 0, sent: 0, failed: 0 };
  for (const target of targets) {
    const reservation = await deliveryAction({ action: "reserve", alertId: target.alertId, subscriptionId: target.id, tier: "digest" }, config, fetchImpl);
    if (!reservation.ok || !reservation.reserved || !reservation.reservationId) continue;
    summary.reserved += 1;
    const payload = JSON.stringify({
      alertId: target.alertId,
      title: target.title,
      body: target.body,
      url: target.url,
      tier: "digest",
      badgeCount: 1,
    });
    try {
      await (dependencies.sendNotification ?? webPush.sendNotification)(normalizedSubscription(target), payload, {
        TTL: 43_200,
        urgency: "low",
        topic: pushTopic(`digest-${new Date().toISOString().slice(0, 10)}`),
        ...(target.contentEncoding === "aesgcm" || target.contentEncoding === "aes128gcm" ? { contentEncoding: target.contentEncoding } : {}),
      });
      await deliveryAction({ action: "complete", reservationId: reservation.reservationId, status: "sent" }, config, fetchImpl);
      summary.sent += 1;
    } catch (error) {
      await deliveryAction({ action: "complete", reservationId: reservation.reservationId, status: "failed", errorCode: deliveryErrorCode(error) }, config, fetchImpl);
      summary.failed += 1;
    }
  }
  return summary;
}

export async function sendProtectionPush(
  purchaseId: string,
  config: PushConfig,
  dependencies: { fetchImpl?: typeof fetch; sendNotification?: typeof webPush.sendNotification } = {},
): Promise<PushDeliverySummary> {
  if (!config.vapidSubject || !config.vapidPublicKey || !config.vapidPrivateKey) {
    throw new SinkConfigurationError("Clés VAPID absentes: bouclier Push désactivé.");
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  if (!dependencies.sendNotification) configureVapid(config);
  const endpoint = apiEndpoint(config.baseUrl, "api/push/protection");
  endpoint.searchParams.set("purchaseId", purchaseId);
  const response = await protectedJson<{ ok: boolean; targets?: ProtectionTarget[] }>(config, endpoint, { method: "GET" }, fetchImpl);
  const targets = Array.isArray(response.targets)
    ? response.targets.filter((target): target is ProtectionTarget => validTarget(target) && Number.isSafeInteger(target.notificationId) && target.notificationId > 0 && typeof target.purchaseId === "string")
    : [];
  const summary: PushDeliverySummary = { eligible: targets.length > 0, targets: targets.length, reserved: targets.length, sent: 0, failed: 0 };
  for (const target of targets) {
    const payload = JSON.stringify({
      alertId: target.purchaseId,
      title: target.title,
      body: target.body,
      url: target.url,
      tier: "protection",
      badgeCount: 1,
    });
    try {
      await (dependencies.sendNotification ?? webPush.sendNotification)(normalizedSubscription(target), payload, {
        TTL: 21_600,
        urgency: "high",
        topic: pushTopic(`shield-${purchaseId}`),
        ...(target.contentEncoding === "aesgcm" || target.contentEncoding === "aes128gcm" ? { contentEncoding: target.contentEncoding } : {}),
      });
      await protectedJson(config, endpoint, { method: "POST", body: JSON.stringify({ notificationId: target.notificationId, status: "sent" }) }, fetchImpl);
      summary.sent += 1;
    } catch (error) {
      await protectedJson(config, endpoint, { method: "POST", body: JSON.stringify({ notificationId: target.notificationId, status: "failed", errorCode: deliveryErrorCode(error) }) }, fetchImpl).catch(() => undefined);
      summary.failed += 1;
    }
  }
  return summary;
}

export async function sendSocialPublicationPush(
  publicationId: string,
  config: PushConfig,
  dependencies: { fetchImpl?: typeof fetch; sendNotification?: typeof webPush.sendNotification } = {},
): Promise<PushDeliverySummary> {
  if (!config.vapidSubject || !config.vapidPublicKey || !config.vapidPrivateKey) {
    throw new SinkConfigurationError("Clés VAPID absentes: notifications sociales désactivées.");
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  if (!dependencies.sendNotification) configureVapid(config);
  const endpoint = apiEndpoint(config.baseUrl, "api/push/social");
  endpoint.searchParams.set("publicationId", publicationId);
  const response = await protectedJson<{ ok: boolean; targets?: SocialTarget[] }>(config, endpoint, { method: "GET" }, fetchImpl);
  const targets = Array.isArray(response.targets)
    ? response.targets.filter((target): target is SocialTarget => validTarget(target)
      && Number.isSafeInteger(target.notificationId)
      && target.notificationId > 0
      && typeof target.attemptId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(target.attemptId)
      && typeof target.publicationId === "string"
      && typeof target.title === "string"
      && typeof target.body === "string"
      && typeof target.url === "string")
    : [];
  const summary: PushDeliverySummary = { eligible: targets.length > 0, targets: targets.length, reserved: targets.length, sent: 0, failed: 0 };
  for (const target of targets) {
    const payload = JSON.stringify({
      alertId: target.publicationId,
      title: target.title,
      body: target.body,
      url: `/?tab=social&publication=${encodeURIComponent(target.publicationId)}`,
      externalUrl: target.url,
      imageUrl: target.imageUrl,
      tier: "social",
      badgeCount: 1,
    });
    try {
      await (dependencies.sendNotification ?? webPush.sendNotification)(normalizedSubscription(target), payload, {
        TTL: 21_600,
        urgency: "normal",
        topic: pushTopic(`social-${publicationId}`),
        ...(target.contentEncoding === "aesgcm" || target.contentEncoding === "aes128gcm" ? { contentEncoding: target.contentEncoding } : {}),
      });
      await protectedJson(config, endpoint, {
        method: "POST",
        body: JSON.stringify({ notificationId: target.notificationId, attemptId: target.attemptId, status: "sent" }),
      }, fetchImpl);
      summary.sent += 1;
    } catch (error) {
      await protectedJson(config, endpoint, {
        method: "POST",
        body: JSON.stringify({ notificationId: target.notificationId, attemptId: target.attemptId, status: "failed", errorCode: deliveryErrorCode(error) }),
      }, fetchImpl).catch(() => undefined);
      summary.failed += 1;
    }
  }
  return summary;
}
