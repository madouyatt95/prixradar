import { stableHash } from "./normalize.js";
import { notificationEligible } from "./verify.js";
import type {
  IngestResponse,
  RetailSource,
  SourceStatusEvent,
  VerifiedObservation,
} from "./types.js";

export interface SinkConfig {
  baseUrl: string;
  ingestSecret: string;
  sitesAuthToken?: string;
  timeoutMs?: number;
  requestNotification?: boolean;
}

export interface AlertIngestEnvelope {
  idempotencyKey: string;
  source: RetailSource;
  eventType: "alert_upsert";
  payload: {
    id: string;
    sourceMode: "live";
    merchant: string;
    market: string;
    productId: string;
    title: string;
    url: string;
    currency: "EUR" | "GBP";
    priceCents: number;
    shippingCents: number | null;
    available: boolean;
    seller: string | null;
    sellerTrusted: boolean;
    condition: "new" | "used" | "refurbished" | "unknown";
    expectedVariantId: string;
    observedVariantId: string;
    merchantReferenceCents: number | null;
    verificationCount: number;
    observedAt: string;
    verifiedAt: string;
    expiresAt: string;
    notify: boolean;
    rawHash: string;
    historicalPrices?: Array<{
      provider: "keepa";
      priceCents: number;
      observedAt: string;
      rawHash: string;
    }>;
  };
}

export interface SourceStatusEnvelope {
  idempotencyKey: string;
  source: RetailSource;
  eventType: "source_status";
  payload: {
    id: string;
    market: string;
    displayName: string;
    mode: "live";
    status: SourceStatusEvent["status"];
    lastSuccessAt: string | null;
    lastAttemptAt: string;
    lastErrorCode: string | null;
    productsSeen: number;
    queueLag: number;
  };
}

export class SinkConfigurationError extends Error {
  override name = "SinkConfigurationError";
}

export class SinkRequestError extends Error {
  override name = "SinkRequestError";
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

function validatedBaseUrl(raw: string): URL {
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password) {
    throw new SinkConfigurationError("PRICE_RADAR_BASE_URL doit être une origine HTTPS valide.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function boundedProductId(value: string, fallback: string): string {
  return value.length <= 160 && /^[\p{L}\p{N}._:/-]+$/u.test(value) ? value : fallback;
}

function directMerchant(source: RetailSource): string {
  return { amazon: "Amazon", boulanger: "Boulanger", darty: "Darty", cdiscount: "Cdiscount" }[source];
}

export function ingestIdempotencyKey(observation: VerifiedObservation): string {
  return stableHash([
    observation.schemaVersion,
    observation.offer.product.productKey,
    observation.offer.price.amountMinor,
    observation.offer.shipping?.amountMinor ?? null,
    observation.offer.price.currency,
    observation.verification.secondObservedAt,
  ]);
}

export function toAlertIngestEnvelope(
  observation: VerifiedObservation,
  requestNotification = true,
): AlertIngestEnvelope {
  const idempotencyKey = ingestIdempotencyKey(observation);
  const product = observation.offer.product;
  const productId = boundedProductId(product.externalId, product.productKey);
  const variantId = boundedProductId(product.externalId, product.productKey);
  const observedAt = observation.offer.observedAt;
  const observedAtMs = Date.parse(observedAt);
  const safeObservedAt = Number.isFinite(observedAtMs) ? observedAt : new Date().toISOString();
  const expiresAt = new Date(Date.parse(safeObservedAt) + 115 * 60_000).toISOString();
  const rawHash = stableHash([
    product.productKey,
    observation.offer.price.amountMinor,
    observation.offer.shipping?.amountMinor ?? null,
    observation.offer.availability,
    observation.offer.seller,
    safeObservedAt,
  ]);
  const historicalPrices = product.source === "amazon" && observation.offer.shipping?.amountMinor === 0
    ? observation.historicalPrices?.slice(0, 60).map((point) => ({
        provider: point.provider,
        priceCents: point.priceMinor,
        observedAt: point.observedAt,
        rawHash: point.rawHash,
      }))
    : undefined;

  return {
    idempotencyKey,
    source: product.source,
    eventType: "alert_upsert",
    payload: {
      id: product.productKey,
      sourceMode: "live",
      merchant: directMerchant(product.source),
      market: product.market,
      productId,
      title: product.title,
      url: product.url,
      currency: observation.offer.price.currency,
      priceCents: observation.offer.price.amountMinor,
      shippingCents: observation.offer.shipping?.amountMinor ?? null,
      available: observation.offer.availability === "in_stock",
      seller: observation.offer.seller,
      sellerTrusted: observation.offer.sellerTrusted,
      condition: observation.offer.condition,
      expectedVariantId: variantId,
      observedVariantId: variantId,
      merchantReferenceCents: observation.offer.referencePrice?.amountMinor ?? null,
      verificationCount: observation.verification.status === "confirmed" ? 2 : 1,
      observedAt: safeObservedAt,
      verifiedAt: observation.verification.secondObservedAt,
      expiresAt,
      notify: requestNotification && notificationEligible(observation),
      rawHash,
      ...(historicalPrices && historicalPrices.length > 0 ? { historicalPrices } : {}),
    },
  };
}

export function toSourceStatusEnvelope(status: SourceStatusEvent): SourceStatusEnvelope {
  if (status.mode !== "live") throw new SinkRequestError("Un statut fixture ne peut pas être ingéré.", null);
  const idempotencyKey = stableHash([
    "source_status",
    status.source,
    status.market,
    status.status,
    status.lastAttemptAt,
  ]);
  return {
    idempotencyKey,
    source: status.source,
    eventType: "source_status",
    payload: {
      id: `${status.source}:${status.market}`,
      market: status.market,
      displayName: status.displayName,
      mode: "live",
      status: status.status,
      lastSuccessAt: status.lastSuccessAt,
      lastAttemptAt: status.lastAttemptAt,
      lastErrorCode: status.lastErrorCode,
      productsSeen: status.productsSeen,
      queueLag: status.queueLag,
    },
  };
}

export function privateApiHeaders(config: {
  secret: string;
  sitesAuthToken?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${config.secret}`,
    "Content-Type": "application/json",
  };
  if (config.sitesAuthToken) {
    headers["OAI-Sites-Authorization"] = `Bearer ${config.sitesAuthToken}`;
  }
  return headers;
}

async function postEnvelope<T>(
  envelope: AlertIngestEnvelope | SourceStatusEnvelope,
  config: SinkConfig,
  fetchImpl: typeof fetch,
): Promise<T> {
  if (!config.ingestSecret.trim()) {
    throw new SinkConfigurationError("INGEST_SECRET absent: ingestion désactivée.");
  }
  const endpoint = new URL("api/ingest", validatedBaseUrl(config.baseUrl));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15_000);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        ...privateApiHeaders({
          secret: config.ingestSecret,
          ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
        }),
        "Idempotency-Key": envelope.idempotencyKey,
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new SinkRequestError(`Ingestion refusée par PrixRadar (HTTP ${response.status}).`, response.status);
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("ok" in payload)) {
      throw new SinkRequestError("Réponse d’ingestion invalide.", response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof SinkRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new SinkRequestError("Délai d’ingestion dépassé.", null);
    }
    throw new SinkRequestError("Échec réseau pendant l’ingestion.", null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function postObservation(
  observation: VerifiedObservation,
  config: SinkConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<IngestResponse> {
  if (observation.offer.fixture) throw new SinkRequestError("Une fixture ne peut jamais être ingérée.", null);
  if (observation.verification.status !== "confirmed") {
    throw new SinkRequestError("Une observation non confirmée ne peut pas être ingérée.", null);
  }
  return postEnvelope<IngestResponse>(
    toAlertIngestEnvelope(observation, config.requestNotification ?? true),
    config,
    fetchImpl,
  );
}

export async function postSourceStatus(
  status: SourceStatusEvent,
  config: SinkConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; accepted?: boolean; duplicate?: boolean }> {
  return postEnvelope(toSourceStatusEnvelope(status), config, fetchImpl);
}
