import {
  isPartnerRetailSource,
  type Market,
  type PartnerRetailSource,
} from "./types.js";

export interface CollectorConfig {
  redisUrl: string;
  browserFallback: boolean;
  httpTimeoutMs: number;
  verifyDelayMs: number;
  maxDiscoveredUrls: number;
  proxyUrls: string[];
  authorizedPartnerSources: PartnerRetailSource[];
  priceRadarBaseUrl: string | null;
  ingestSecret: string | null;
  pushDeliverySecret: string | null;
  sitesAuthToken: string | null;
  keepaApiKey: string | null;
  keepaMarkets: Market[];
  keepaMaxQuotaWaitMs: number;
  vapidSubject: string | null;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
}

function optional(value: string | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function boolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function markets(value: string | undefined): Market[] {
  const supported = new Set<Market>(["FR", "DE", "IT", "ES", "GB"]);
  const requested = (value ?? "FR,DE,IT,ES,GB")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is Market => supported.has(entry as Market));
  return [...new Set(requested)];
}

function authorizedPartnerSources(value: string | undefined): PartnerRetailSource[] {
  const requested = (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const invalid = requested.filter((entry) => !isPartnerRetailSource(entry));
  if (invalid.length > 0) {
    throw new Error(`AUTHORIZED_PARTNER_SOURCES contient une source invalide: ${[...new Set(invalid)].join(", ")}.`);
  }
  return [...new Set(requested.filter(isPartnerRetailSource))];
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const ingestSecret = optional(environment.INGEST_SECRET);
  const pushDeliverySecret = optional(environment.PUSH_DELIVERY_SECRET);
  if (ingestSecret && pushDeliverySecret && ingestSecret === pushDeliverySecret) {
    throw new Error("INGEST_SECRET et PUSH_DELIVERY_SECRET doivent être distincts.");
  }
  return {
    redisUrl: environment.REDIS_URL?.trim() || "redis://127.0.0.1:6379",
    browserFallback: boolean(environment.ENABLE_BROWSER_FALLBACK),
    httpTimeoutMs: integer(environment.COLLECTOR_HTTP_TIMEOUT_MS, 15_000, 1_000, 120_000),
    verifyDelayMs: integer(environment.VERIFY_DELAY_MS, 2_500, 0, 60_000),
    maxDiscoveredUrls: integer(environment.MAX_DISCOVERED_URLS, 100, 1, 1_000),
    proxyUrls: (environment.PROXY_URLS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    authorizedPartnerSources: authorizedPartnerSources(environment.AUTHORIZED_PARTNER_SOURCES),
    priceRadarBaseUrl: optional(environment.PRICE_RADAR_BASE_URL),
    ingestSecret,
    pushDeliverySecret,
    sitesAuthToken: optional(environment.OAI_SITES_AUTH_TOKEN),
    keepaApiKey: optional(environment.KEEPA_API_KEY),
    keepaMarkets: markets(environment.KEEPA_MARKETS),
    keepaMaxQuotaWaitMs: integer(environment.KEEPA_MAX_QUOTA_WAIT_MS, 60_000, 0, 900_000),
    vapidSubject: optional(environment.VAPID_SUBJECT),
    vapidPublicKey: optional(environment.VAPID_PUBLIC_KEY),
    vapidPrivateKey: optional(environment.VAPID_PRIVATE_KEY),
  };
}
