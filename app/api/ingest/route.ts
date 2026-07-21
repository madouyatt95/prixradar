import { runtimeEnv as env } from "@/lib/runtime-env";
import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  alerts,
  alertFeedback,
  collectionRuns,
  ingestEvents,
  keepaCache,
  keepaUsage,
  notificationDeliveries,
  priceObservations,
  pushSubscriptions,
  sourceStatuses,
  sourceConfigurations,
} from "@/db/schema";
import {
  AnomalyInputError,
  evaluatePriceAnomaly,
  type AnomalyCandidate,
  type ProductCondition,
  type SourceMode,
} from "@/lib/anomaly";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_MONEY_CENTS = 100_000_000;
const MAX_ALERT_LIFETIME_MS = 120 * 60_000;
const SOURCES = ["amazon", "boulanger", "cdiscount", "darty"] as const;
const AMAZON_MARKETS = new Set(["DE", "ES", "FR", "GB", "IT"]);
const SOURCE_MODES = new Set<SourceMode>(["live", "demo", "fixture"]);
const CONDITIONS = new Set<ProductCondition>(["new", "used", "refurbished", "unknown"]);
const SOURCE_STATUSES = new Set(["healthy", "degraded", "offline", "not_configured"]);
const PROMOTION_TYPES = new Set(["public_price", "coupon", "membership", "cashback", "trade_in", "bundle", "unknown"]);

type Source = (typeof SOURCES)[number];
type UnknownRecord = Record<string, unknown>;

type IngestEnvelope = {
  idempotencyKey: string;
  source: Source;
  eventType: "alert_upsert" | "source_status";
  payload: UnknownRecord;
};

type ParsedAlert = {
  id: string;
  sourceMode: SourceMode;
  merchant: string;
  market: string;
  productId: string;
  identityKey: string | null;
  title: string;
  brand: string | null;
  model: string | null;
  gtin: string | null;
  category: string | null;
  url: string;
  currency: "EUR" | "GBP";
  priceCents: number;
  shippingCents: number | null;
  available: boolean;
  seller: string | null;
  sellerTrusted: boolean;
  condition: ProductCondition;
  expectedVariantId: string | null;
  observedVariantId: string | null;
  merchantReferenceCents: number | null;
  verificationCount: number;
  observedAt: string;
  verifiedAt: string | null;
  expiresAt: string;
  notify: boolean;
  rawHash: string | null;
  historicalPrices: ParsedHistoricalPrice[];
  publicPriceCents: number | null;
  priceAccessibleToAll: boolean;
  promotionType: string;
  promotionLabel: string | null;
};

type ParsedHistoricalPrice = {
  provider: "keepa";
  priceCents: number;
  observedAt: string;
  rawHash: string;
};

type ParsedSourceStatus = {
  id: string;
  market: string;
  displayName: string;
  mode: SourceMode;
  status: "healthy" | "degraded" | "offline" | "not_configured";
  lastSuccessAt: string | null;
  lastAttemptAt: string;
  lastErrorCode: string | null;
  productsSeen: number;
  queueLag: number;
  duplicatesSkipped: number;
  antiBotBlocked: boolean;
  keepaRequests: number;
  apifyCostMicros: number | null;
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function apiError(status: number, code: string, message: string) {
  return json({ ok: false, code, message }, status);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureOnlyKeys(value: UnknownRecord, allowed: readonly string[], field = "payload") {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) throw new Error(`${field} contient des champs non autorisés.`);
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string") throw new Error(`${field} doit être une chaîne.`);
  const cleaned = value.trim();
  if (cleaned.length === 0) throw new Error(`${field} est obligatoire.`);
  if (cleaned.length > maxLength || /\p{Cc}/u.test(cleaned)) throw new Error(`${field} est invalide.`);
  return cleaned;
}

function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === null || value === undefined) return null;
  return requiredString(value, field, maxLength);
}

function requiredBoolean(value: unknown, field: string) {
  if (typeof value !== "boolean") throw new Error(`${field} doit être un booléen.`);
  return value;
}

function optionalBoolean(value: unknown, field: string, fallback: boolean) {
  return value === undefined ? fallback : requiredBoolean(value, field);
}

function integerInRange(value: unknown, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} doit être un entier compris entre ${minimum} et ${maximum}.`);
  }
  return value as number;
}

function nullableMoney(value: unknown, field: string) {
  if (value === null || value === undefined) return null;
  return integerInRange(value, field, 0, MAX_MONEY_CENTS);
}

function isoTimestamp(value: unknown, field: string, nullable = false): string | null {
  if ((value === null || value === undefined) && nullable) return null;
  const raw = requiredString(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) throw new Error(`${field} doit être une date ISO 8601.`);
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) throw new Error(`${field} doit être une date ISO 8601 valide.`);
  return new Date(timestamp).toISOString();
}

function normalizeMarket(source: Source, value: unknown) {
  const market = requiredString(value, "market", 8).toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(market)) throw new Error("market est invalide.");
  if (source === "amazon" && !AMAZON_MARKETS.has(market)) {
    throw new Error("Amazon via Keepa accepte uniquement DE, ES, FR, GB et IT.");
  }
  if (source !== "amazon" && market !== "FR") throw new Error("Cette enseigne accepte uniquement le marché FR.");
  return market;
}

function validateProductUrl(source: Source, market: string, value: unknown) {
  const raw = requiredString(value, "url", 2_048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("url doit être une adresse HTTPS valide.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("url doit être une adresse HTTPS publique valide.");
  }

  const allowedHosts: Record<Source, string[]> = {
    amazon: [
      market === "GB" ? "amazon.co.uk" : `amazon.${market.toLowerCase()}`,
    ],
    boulanger: ["boulanger.com"],
    cdiscount: ["cdiscount.com"],
    darty: ["darty.com"],
  };
  const hostname = parsed.hostname.toLowerCase();
  if (!allowedHosts[source].some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new Error("url ne correspond pas à l’enseigne déclarée.");
  }
  return parsed.toString();
}

function parseSource(value: unknown): Source {
  const source = requiredString(value, "source", 24).toLowerCase();
  if (!SOURCES.includes(source as Source)) throw new Error("source n’est pas prise en charge.");
  return source as Source;
}

function parseEnvelope(value: unknown): IngestEnvelope {
  if (!isRecord(value)) throw new Error("Le corps doit être un objet JSON.");
  ensureOnlyKeys(value, ["idempotencyKey", "source", "eventType", "payload"], "corps");

  const idempotencyKey = requiredString(value.idempotencyKey, "idempotencyKey", 160);
  if (!/^[A-Za-z0-9._:-]{16,160}$/.test(idempotencyKey)) throw new Error("idempotencyKey est invalide.");
  const source = parseSource(value.source);
  if (value.eventType !== "alert_upsert" && value.eventType !== "source_status") {
    throw new Error("eventType doit être alert_upsert ou source_status.");
  }
  if (!isRecord(value.payload)) throw new Error("payload doit être un objet JSON.");

  return { idempotencyKey, source, eventType: value.eventType, payload: value.payload };
}

function parseAlert(source: Source, value: UnknownRecord): ParsedAlert {
  ensureOnlyKeys(value, [
    "id",
    "sourceMode",
    "merchant",
    "market",
    "productId",
    "identityKey",
    "title",
    "brand",
    "model",
    "gtin",
    "category",
    "url",
    "currency",
    "priceCents",
    "shippingCents",
    "available",
    "seller",
    "sellerTrusted",
    "condition",
    "expectedVariantId",
    "observedVariantId",
    "merchantReferenceCents",
    "verificationCount",
    "observedAt",
    "verifiedAt",
    "expiresAt",
    "notify",
    "rawHash",
    "historicalPrices",
    "publicPriceCents",
    "priceAccessibleToAll",
    "promotionType",
    "promotionLabel",
  ]);

  const id = requiredString(value.id, "id", 160);
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(id)) throw new Error("id est invalide.");
  const sourceMode = requiredString(value.sourceMode, "sourceMode", 16) as SourceMode;
  if (!SOURCE_MODES.has(sourceMode)) throw new Error("sourceMode doit être live, demo ou fixture.");
  const market = normalizeMarket(source, value.market);
  const currency = requiredString(value.currency, "currency", 3).toUpperCase();
  const expectedCurrency = market === "GB" ? "GBP" : "EUR";
  if (currency !== expectedCurrency) throw new Error(`currency doit être ${expectedCurrency} pour ce marché.`);

  const productId = requiredString(value.productId, "productId", 160);
  if (!/^[\p{L}\p{N}._:/-]+$/u.test(productId)) throw new Error("productId est invalide.");
  const condition = requiredString(value.condition, "condition", 20) as ProductCondition;
  if (!CONDITIONS.has(condition)) throw new Error("condition est invalide.");
  const expectedVariantId = optionalString(value.expectedVariantId, "expectedVariantId", 160);
  const observedVariantId = optionalString(value.observedVariantId, "observedVariantId", 160);
  const seller = optionalString(value.seller, "seller", 160);
  const rawHash = optionalString(value.rawHash, "rawHash", 64);
  if (rawHash !== null && !/^[a-f0-9]{64}$/i.test(rawHash)) throw new Error("rawHash doit être un SHA-256 hexadécimal.");

  const historicalValues = value.historicalPrices === undefined ? [] : value.historicalPrices;
  if (!Array.isArray(historicalValues) || historicalValues.length > 60) {
    throw new Error("historicalPrices doit contenir au maximum 60 points.");
  }
  if (historicalValues.length > 0 && source !== "amazon") {
    throw new Error("historicalPrices est réservé à Amazon via Keepa.");
  }
  const historicalPrices = historicalValues.map((entry, index): ParsedHistoricalPrice => {
    if (!isRecord(entry)) throw new Error(`historicalPrices[${index}] doit être un objet.`);
    ensureOnlyKeys(entry, ["provider", "priceCents", "observedAt", "rawHash"], `historicalPrices[${index}]`);
    if (entry.provider !== "keepa") throw new Error(`historicalPrices[${index}].provider doit être keepa.`);
    const pointHash = requiredString(entry.rawHash, `historicalPrices[${index}].rawHash`, 64);
    if (!/^[a-f0-9]{64}$/i.test(pointHash)) throw new Error(`historicalPrices[${index}].rawHash est invalide.`);
    return {
      provider: "keepa",
      priceCents: integerInRange(entry.priceCents, `historicalPrices[${index}].priceCents`, 1, MAX_MONEY_CENTS),
      observedAt: isoTimestamp(entry.observedAt, `historicalPrices[${index}].observedAt`) as string,
      rawHash: pointHash.toLowerCase(),
    };
  });

  const parsed: ParsedAlert = {
    id,
    sourceMode,
    merchant: requiredString(value.merchant, "merchant", 120),
    market,
    productId,
    identityKey: optionalString(value.identityKey, "identityKey", 160),
    title: requiredString(value.title, "title", 300),
    brand: optionalString(value.brand, "brand", 120),
    model: optionalString(value.model, "model", 160),
    gtin: optionalString(value.gtin, "gtin", 32),
    category: optionalString(value.category, "category", 80),
    url: validateProductUrl(source, market, value.url),
    currency: currency as "EUR" | "GBP",
    priceCents: integerInRange(value.priceCents, "priceCents", 1, MAX_MONEY_CENTS),
    shippingCents: nullableMoney(value.shippingCents, "shippingCents"),
    available: requiredBoolean(value.available, "available"),
    seller,
    sellerTrusted: requiredBoolean(value.sellerTrusted, "sellerTrusted"),
    condition,
    expectedVariantId,
    observedVariantId,
    merchantReferenceCents: nullableMoney(value.merchantReferenceCents, "merchantReferenceCents"),
    verificationCount: integerInRange(value.verificationCount, "verificationCount", 0, 20),
    observedAt: isoTimestamp(value.observedAt, "observedAt") as string,
    verifiedAt: isoTimestamp(value.verifiedAt, "verifiedAt", true),
    expiresAt: isoTimestamp(value.expiresAt, "expiresAt") as string,
    notify: optionalBoolean(value.notify, "notify", false),
    rawHash,
    historicalPrices,
    publicPriceCents: nullableMoney(value.publicPriceCents, "publicPriceCents"),
    priceAccessibleToAll: optionalBoolean(value.priceAccessibleToAll, "priceAccessibleToAll", true),
    promotionType: value.promotionType === undefined ? "public_price" : requiredString(value.promotionType, "promotionType", 32),
    promotionLabel: optionalString(value.promotionLabel, "promotionLabel", 240),
  };
  if (!PROMOTION_TYPES.has(parsed.promotionType)) throw new Error("promotionType est invalide.");
  if (parsed.priceAccessibleToAll && parsed.publicPriceCents === null) parsed.publicPriceCents = parsed.priceCents;
  if (!parsed.priceAccessibleToAll && parsed.promotionType === "public_price") throw new Error("Un prix conditionnel doit préciser son type de promotion.");

  const observedAtMs = Date.parse(parsed.observedAt);
  const expiresAtMs = Date.parse(parsed.expiresAt);
  if (observedAtMs > Date.now() + 5 * 60_000) throw new Error("observedAt ne peut pas être dans le futur.");
  if (expiresAtMs <= observedAtMs) {
    throw new Error("expiresAt doit être postérieur à observedAt.");
  }
  if (expiresAtMs > observedAtMs + MAX_ALERT_LIFETIME_MS) {
    throw new Error("expiresAt ne peut pas dépasser 120 minutes après observedAt.");
  }
  if (parsed.notify && parsed.sourceMode !== "live") {
    throw new Error("Une donnée demo ou fixture ne peut jamais demander une notification.");
  }
  if (parsed.historicalPrices.length > 0 && parsed.shippingCents !== 0) {
    throw new Error("L’historique Keepa n’est accepté que si la livraison actuelle est explicitement gratuite.");
  }
  const minimumHistoryTimestamp = observedAtMs - 180 * 86_400_000;
  const uniqueHistoryHashes = new Set<string>();
  for (const point of parsed.historicalPrices) {
    const timestamp = Date.parse(point.observedAt);
    if (timestamp >= observedAtMs || timestamp < minimumHistoryTimestamp) {
      throw new Error("historicalPrices doit précéder observedAt de moins de 180 jours.");
    }
    if (uniqueHistoryHashes.has(point.rawHash)) throw new Error("historicalPrices contient un doublon.");
    uniqueHistoryHashes.add(point.rawHash);
  }
  return parsed;
}

function parseSourceStatus(source: Source, value: UnknownRecord): ParsedSourceStatus {
  ensureOnlyKeys(value, [
    "id",
    "market",
    "displayName",
    "mode",
    "status",
    "lastSuccessAt",
    "lastAttemptAt",
    "lastErrorCode",
    "productsSeen",
    "queueLag",
    "duplicatesSkipped",
    "antiBotBlocked",
    "keepaRequests",
    "apifyCostMicros",
  ]);
  const market = normalizeMarket(source, value.market);
  const mode = requiredString(value.mode, "mode", 16) as SourceMode;
  if (!SOURCE_MODES.has(mode)) throw new Error("mode doit être live, demo ou fixture.");
  const status = requiredString(value.status, "status", 24) as ParsedSourceStatus["status"];
  if (!SOURCE_STATUSES.has(status)) throw new Error("status est invalide.");
  const canonicalId = `${source}:${market}`;
  const id = value.id === undefined ? canonicalId : requiredString(value.id, "id", 160);
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(id)) throw new Error("id est invalide.");
  if (id !== canonicalId) throw new Error(`id doit être ${canonicalId}.`);
  const lastErrorCode = optionalString(value.lastErrorCode, "lastErrorCode", 80);
  if (lastErrorCode !== null && !/^[A-Z0-9_:-]+$/.test(lastErrorCode)) {
    throw new Error("lastErrorCode est invalide.");
  }

  const parsed: ParsedSourceStatus = {
    id,
    market,
    displayName: requiredString(value.displayName, "displayName", 120),
    mode,
    status,
    lastSuccessAt: isoTimestamp(value.lastSuccessAt, "lastSuccessAt", true),
    lastAttemptAt: isoTimestamp(value.lastAttemptAt, "lastAttemptAt") as string,
    lastErrorCode,
    productsSeen: integerInRange(value.productsSeen, "productsSeen", 0, 1_000_000_000),
    queueLag: integerInRange(value.queueLag, "queueLag", 0, 10_000_000),
    duplicatesSkipped: value.duplicatesSkipped === undefined ? 0 : integerInRange(value.duplicatesSkipped, "duplicatesSkipped", 0, 1_000_000_000),
    antiBotBlocked: optionalBoolean(value.antiBotBlocked, "antiBotBlocked", false),
    keepaRequests: value.keepaRequests === undefined ? 0 : integerInRange(value.keepaRequests, "keepaRequests", 0, 1_000_000_000),
    apifyCostMicros: value.apifyCostMicros === undefined ? null : nullableMoney(value.apifyCostMicros, "apifyCostMicros"),
  };
  const maximumFuture = Date.now() + 5 * 60_000;
  if (Date.parse(parsed.lastAttemptAt) > maximumFuture) throw new Error("lastAttemptAt ne peut pas être dans le futur.");
  if (parsed.lastSuccessAt !== null && Date.parse(parsed.lastSuccessAt) > Date.parse(parsed.lastAttemptAt)) {
    throw new Error("lastSuccessAt ne peut pas être postérieur à lastAttemptAt.");
  }
  return parsed;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as UnknownRecord;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secretsEqual(received: string, expected: string) {
  const [left, right] = await Promise.all([sha256(received), sha256(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function serverIngestSecret() {
  const workerSecret = (env as unknown as { INGEST_SECRET?: unknown }).INGEST_SECRET;
  if (typeof workerSecret === "string" && workerSecret.length >= 24) return workerSecret;
  const nodeSecret = process.env.INGEST_SECRET;
  return typeof nodeSecret === "string" && nodeSecret.length >= 24 ? nodeSecret : null;
}

async function authenticate(request: Request) {
  const expected = serverIngestSecret();
  if (expected === null) return { ok: false as const, response: apiError(503, "INGEST_NOT_CONFIGURED", "L’ingestion serveur n’est pas configurée.") };

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]{1,512})$/.exec(authorization);
  if (!match || !(await secretsEqual(match[1], expected))) {
    return { ok: false as const, response: apiError(401, "UNAUTHORIZED", "Authentification d’ingestion invalide.") };
  }
  return { ok: true as const };
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("D1 binding") || message.includes("env.DB")) {
    return apiError(503, "DATABASE_UNAVAILABLE", "La base de données d’ingestion est indisponible.");
  }
  if (message.includes("no such table")) {
    return apiError(503, "INGEST_NOT_READY", "Le schéma d’ingestion n’est pas encore initialisé.");
  }
  return apiError(500, "INGEST_FAILED", "L’événement n’a pas pu être enregistré.");
}

async function existingEvent(idempotencyKey: string) {
  const rows = await getDb()
    .select({ payloadHash: ingestEvents.payloadHash, accepted: ingestEvents.accepted })
    .from(ingestEvents)
    .where(eq(ingestEvents.idempotencyKey, idempotencyKey))
    .limit(1);
  return rows[0] ?? null;
}

function duplicateResponse(existing: { payloadHash: string; accepted: boolean }, payloadHash: string) {
  if (existing.payloadHash !== payloadHash) {
    return apiError(409, "IDEMPOTENCY_CONFLICT", "Cette clé d’idempotence correspond déjà à un contenu différent.");
  }
  return json({ ok: existing.accepted, duplicate: true, accepted: existing.accepted });
}

async function ingestAlert(envelope: IngestEnvelope, parsed: ParsedAlert, payloadHash: string) {
  const database = getDb();
  const [priorRows, existingAlerts, comparableRows, feedbackRows] = await Promise.all([
    database
      .select({
        priceCents: priceObservations.priceCents,
        shippingCents: priceObservations.shippingCents,
        totalCents: priceObservations.totalCents,
        available: priceObservations.available,
        observedAt: priceObservations.observedAt,
        rawHash: priceObservations.rawHash,
      })
      .from(priceObservations)
      .where(eq(priceObservations.alertId, parsed.id))
      .orderBy(desc(priceObservations.observedAt))
      .limit(180),
    database
      .select({ source: alerts.source, market: alerts.market, productId: alerts.productId, status: alerts.status })
      .from(alerts)
      .where(eq(alerts.id, parsed.id))
      .limit(1),
    parsed.identityKey === null
      ? Promise.resolve([])
      : database
          .select({ source: alerts.source, publicPriceCents: alerts.publicPriceCents })
          .from(alerts)
          .where(and(
            eq(alerts.identityKey, parsed.identityKey),
            ne(alerts.source, envelope.source),
            eq(alerts.currency, parsed.currency),
            eq(alerts.priceAccessibleToAll, true),
            gte(alerts.observedAt, new Date(Date.parse(parsed.observedAt) - 7 * 86_400_000).toISOString()),
          ))
          .orderBy(desc(alerts.observedAt))
          .limit(30),
    database.select({
      useful: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'useful' then 1 else 0 end), 0)`,
      falsePositive: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'false_positive' then 1 else 0 end), 0)`,
    }).from(alertFeedback).innerJoin(alerts, eq(alerts.id, alertFeedback.alertId)).where(and(
      eq(alerts.source, envelope.source),
      ...(parsed.category ? [eq(alerts.category, parsed.category)] : []),
    )),
  ]);
  const existingAlert = existingAlerts[0];
  if (
    existingAlert &&
    (existingAlert.source !== envelope.source ||
      existingAlert.market !== parsed.market ||
      existingAlert.productId !== parsed.productId)
  ) {
    return apiError(409, "ALERT_IDENTITY_CONFLICT", "Cet identifiant d’alerte appartient à un autre produit.");
  }

  const comparableBySource = new Map<string, number>();
  for (const row of comparableRows) {
    if (row.publicPriceCents !== null && !comparableBySource.has(row.source)) comparableBySource.set(row.source, row.publicPriceCents);
  }
  const candidate: AnomalyCandidate = {
    priceCents: parsed.priceCents,
    shippingCents: parsed.shippingCents,
    available: parsed.available,
    observedAt: parsed.observedAt,
    expiresAt: parsed.expiresAt,
    sourceMode: parsed.sourceMode,
    condition: parsed.condition,
    expectedVariantId: parsed.expectedVariantId,
    observedVariantId: parsed.observedVariantId,
    seller: parsed.seller,
    sellerTrusted: parsed.sellerTrusted,
    verificationCount: parsed.verificationCount,
    verifiedAt: parsed.verifiedAt,
    merchantReferenceCents: parsed.merchantReferenceCents,
    priceAccessibleToAll: parsed.priceAccessibleToAll,
    crossMerchantPricesCents: [...comparableBySource.values()],
  };
  const evaluation = evaluatePriceAnomaly(
    candidate,
    [
      ...parsed.historicalPrices.map((point) => ({
        priceCents: point.priceCents,
        shippingCents: 0,
        totalCents: point.priceCents,
        available: true,
        observedAt: point.observedAt,
        rawHash: point.rawHash,
      })),
      ...priorRows.map((row) => ({
        priceCents: row.priceCents,
        shippingCents: row.shippingCents,
        totalCents: row.totalCents,
        available: row.available,
        observedAt: row.observedAt,
        rawHash: row.rawHash,
      })),
    ],
  );
  const feedback = feedbackRows[0] ?? { useful: 0, falsePositive: 0 };
  const adaptiveScoreAdjustment = Math.max(0, Math.min(15, (Number(feedback.falsePositive) - Number(feedback.useful)) * 2));
  const adaptiveMinimumScore = 65 + adaptiveScoreAdjustment;
  const notificationEligible = evaluation.notificationEligible && evaluation.score >= adaptiveMinimumScore;
  const now = new Date().toISOString();
  const alertStatus = notificationEligible
    ? "active"
    : existingAlert?.status === "active" && (!evaluation.checks.materialDiscount || !parsed.available)
      ? "expired"
      : evaluation.score >= 40 ? "review" : "monitoring";
  const evidenceJson = JSON.stringify({
    version: 1,
    provider: envelope.source === "amazon" ? "keepa" : envelope.source,
    notificationRequested: parsed.notify,
    notificationEligible,
    adaptiveMinimumScore,
    feedbackSample: Number(feedback.falsePositive) + Number(feedback.useful),
    expectedVariantId: parsed.expectedVariantId,
    observedVariantId: parsed.observedVariantId,
    sellerTrusted: parsed.sellerTrusted,
    historyProvider: parsed.historicalPrices.length > 0 ? "keepa" : null,
    importedHistoryPoints: parsed.historicalPrices.length,
    analysis: evaluation,
  });
  const rawHash =
    parsed.rawHash ??
    (await sha256(
      stableJson({
        alertId: parsed.id,
        priceCents: parsed.priceCents,
        shippingCents: parsed.shippingCents,
        available: parsed.available,
        observedAt: parsed.observedAt,
        seller: parsed.seller,
        observedVariantId: parsed.observedVariantId,
      }),
    ));

  const eventInsert = database.insert(ingestEvents).values({
    idempotencyKey: envelope.idempotencyKey,
    source: envelope.source,
    eventType: envelope.eventType,
    payloadHash,
    accepted: true,
    createdAt: now,
  });
  const alertUpsert = database
    .insert(alerts)
    .values({
      id: parsed.id,
      source: envelope.source,
      sourceMode: parsed.sourceMode,
      merchant: parsed.merchant,
      market: parsed.market,
      productId: parsed.productId,
      identityKey: parsed.identityKey,
      title: parsed.title,
      brand: parsed.brand,
      model: parsed.model,
      gtin: parsed.gtin,
      category: parsed.category,
      url: parsed.url,
      currency: parsed.currency,
      priceCents: parsed.priceCents,
      usualPriceCents: evaluation.usualPriceCents ?? parsed.priceCents,
      discountPercent: Math.max(0, Math.round(evaluation.discountPercent)),
      score: evaluation.score,
      confidence: evaluation.confidence,
      status: alertStatus,
      seller: parsed.seller,
      condition: parsed.condition,
      shippingCents: parsed.shippingCents,
      publicPriceCents: parsed.publicPriceCents,
      priceAccessibleToAll: parsed.priceAccessibleToAll,
      promotionType: parsed.promotionType,
      promotionLabel: parsed.promotionLabel,
      evidenceJson,
      observedAt: parsed.observedAt,
      verifiedAt: parsed.verifiedAt,
      expiresAt: parsed.expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: alerts.id,
      set: {
        sourceMode: parsed.sourceMode,
        merchant: parsed.merchant,
        market: parsed.market,
        productId: parsed.productId,
        identityKey: parsed.identityKey,
        title: parsed.title,
        brand: parsed.brand,
        model: parsed.model,
        gtin: parsed.gtin,
        category: parsed.category,
        url: parsed.url,
        currency: parsed.currency,
        priceCents: parsed.priceCents,
        usualPriceCents: evaluation.usualPriceCents ?? parsed.priceCents,
        discountPercent: Math.max(0, Math.round(evaluation.discountPercent)),
        score: evaluation.score,
        confidence: evaluation.confidence,
        status: alertStatus,
        seller: parsed.seller,
        condition: parsed.condition,
        shippingCents: parsed.shippingCents,
        publicPriceCents: parsed.publicPriceCents,
        priceAccessibleToAll: parsed.priceAccessibleToAll,
        promotionType: parsed.promotionType,
        promotionLabel: parsed.promotionLabel,
        evidenceJson,
        observedAt: parsed.observedAt,
        verifiedAt: parsed.verifiedAt,
        expiresAt: parsed.expiresAt,
        updatedAt: now,
      },
    });
  const observationInsert = database
    .insert(priceObservations)
    .values({
      alertId: parsed.id,
      priceCents: parsed.priceCents,
      shippingCents: parsed.shippingCents,
      totalCents: parsed.shippingCents === null ? null : evaluation.currentTotalCents,
      available: parsed.available,
      observedAt: parsed.observedAt,
      rawHash,
    })
    .onConflictDoNothing({ target: [priceObservations.alertId, priceObservations.rawHash] });

  const historyInsert = parsed.historicalPrices.length === 0
    ? null
    : database
        .insert(priceObservations)
        .values(parsed.historicalPrices.map((point) => ({
          alertId: parsed.id,
          priceCents: point.priceCents,
          shippingCents: 0,
          totalCents: point.priceCents,
          available: true,
          observedAt: point.observedAt,
          rawHash: point.rawHash,
        })))
        .onConflictDoNothing({ target: [priceObservations.alertId, priceObservations.rawHash] });

  if (historyInsert) await database.batch([eventInsert, alertUpsert, historyInsert, observationInsert]);
  else await database.batch([eventInsert, alertUpsert, observationInsert]);

  return json(
    {
      ok: true,
      duplicate: false,
      accepted: true,
      alert: {
        id: parsed.id,
        status: alertStatus,
        score: evaluation.score,
        confidence: evaluation.confidence,
        notificationRequested: parsed.notify,
        notificationEligible,
        blockingReasons: evaluation.blockingReasons,
      },
    },
    202,
  );
}

async function ingestSourceStatus(envelope: IngestEnvelope, parsed: ParsedSourceStatus, payloadHash: string) {
  const database = getDb();
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const eventInsert = database.insert(ingestEvents).values({
    idempotencyKey: envelope.idempotencyKey,
    source: envelope.source,
    eventType: envelope.eventType,
    payloadHash,
    accepted: true,
    createdAt: now,
  });
  const statusUpsert = database
    .insert(sourceStatuses)
    .values({
      id: parsed.id,
      source: envelope.source,
      market: parsed.market,
      displayName: parsed.displayName,
      mode: parsed.mode,
      status: parsed.status,
      lastSuccessAt: parsed.lastSuccessAt,
      lastAttemptAt: parsed.lastAttemptAt,
      lastErrorCode: parsed.lastErrorCode,
      productsSeen: parsed.productsSeen,
      queueLag: parsed.queueLag,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sourceStatuses.id,
      set: {
        displayName: parsed.displayName,
        mode: parsed.mode,
        status: parsed.status,
        lastSuccessAt: parsed.lastSuccessAt,
        lastAttemptAt: parsed.lastAttemptAt,
        lastErrorCode: parsed.lastErrorCode,
        productsSeen: parsed.productsSeen,
        queueLag: parsed.queueLag,
        updatedAt: now,
      },
    });
  const runInsert = database.insert(collectionRuns).values({
    id: envelope.idempotencyKey,
    source: envelope.source,
    market: parsed.market,
    status: parsed.status,
    productsSeen: parsed.productsSeen,
    queueLag: parsed.queueLag,
    duplicatesSkipped: parsed.duplicatesSkipped,
    antiBotBlocked: parsed.antiBotBlocked,
    keepaRequests: parsed.keepaRequests,
    apifyCostMicros: parsed.apifyCostMicros,
    errorCode: parsed.lastErrorCode,
    attemptedAt: parsed.lastAttemptAt,
    createdAt: now,
  }).onConflictDoNothing({ target: collectionRuns.id });
  const configurationUpdate = database.update(sourceConfigurations).set({
    lastRunAt: parsed.lastAttemptAt,
    ...(parsed.lastSuccessAt ? { lastSuccessAt: parsed.lastSuccessAt } : {}),
    productsSeen: parsed.productsSeen,
    duplicateUrls: parsed.duplicatesSkipped,
    updatedAt: now,
  }).where(and(eq(sourceConfigurations.source, envelope.source), eq(sourceConfigurations.market, parsed.market)));
  const daysAgo = (days: number) => new Date(nowDate.getTime() - days * 86_400_000).toISOString();
  await database.batch([
    eventInsert,
    statusUpsert,
    runInsert,
    configurationUpdate,
    database
      .update(alerts)
      .set({ status: "expired", updatedAt: now })
      .where(and(eq(alerts.status, "active"), lt(alerts.expiresAt, now))),
    database.delete(priceObservations).where(lt(priceObservations.observedAt, daysAgo(180))),
    database.delete(ingestEvents).where(lt(ingestEvents.createdAt, daysAgo(90))),
    database.delete(notificationDeliveries).where(lt(notificationDeliveries.attemptedAt, daysAgo(90))),
    database.delete(collectionRuns).where(lt(collectionRuns.attemptedAt, daysAgo(90))),
    database.delete(alerts).where(and(lt(alerts.expiresAt, now), lt(alerts.updatedAt, daysAgo(30)))),
    database
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.enabled, false), lt(pushSubscriptions.updatedAt, daysAgo(90)))),
    database.delete(keepaCache).where(lt(keepaCache.expiresAt, daysAgo(1))),
    database.delete(keepaUsage).where(lt(keepaUsage.windowStart, daysAgo(2))),
  ]);
  return json({ ok: true, duplicate: false, accepted: true, sourceStatus: { id: parsed.id, status: parsed.status } }, 202);
}

export async function POST(request: Request) {
  const authentication = await authenticate(request);
  if (!authentication.ok) return authentication.response;

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return apiError(413, "PAYLOAD_TOO_LARGE", "Le corps dépasse la taille autorisée.");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return apiError(400, "INVALID_BODY", "Le corps de la requête est illisible.");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return apiError(413, "PAYLOAD_TOO_LARGE", "Le corps dépasse la taille autorisée.");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return apiError(400, "INVALID_JSON", "Le corps JSON est invalide.");
  }

  let envelope: IngestEnvelope;
  try {
    envelope = parseEnvelope(raw);
  } catch (error) {
    return apiError(400, "INVALID_EVENT", error instanceof Error ? error.message : "Événement invalide.");
  }

  const payloadHash = await sha256(stableJson(raw));

  try {
    const existing = await existingEvent(envelope.idempotencyKey);
    if (existing !== null) return duplicateResponse(existing, payloadHash);

    if (envelope.eventType === "alert_upsert") {
      let parsed: ParsedAlert;
      try {
        parsed = parseAlert(envelope.source, envelope.payload);
      } catch (error) {
        return apiError(422, "INVALID_ALERT", error instanceof Error ? error.message : "Alerte invalide.");
      }
      return await ingestAlert(envelope, parsed, payloadHash);
    }

    let parsed: ParsedSourceStatus;
    try {
      parsed = parseSourceStatus(envelope.source, envelope.payload);
    } catch (error) {
      return apiError(422, "INVALID_SOURCE_STATUS", error instanceof Error ? error.message : "État source invalide.");
    }
    return await ingestSourceStatus(envelope, parsed, payloadHash);
  } catch (error) {
    if (error instanceof AnomalyInputError) return apiError(422, "INVALID_ANOMALY_INPUT", error.message);

    // A concurrent request can win the unique idempotency insert after our first read.
    try {
      const existing = await existingEvent(envelope.idempotencyKey);
      if (existing !== null) return duplicateResponse(existing, payloadHash);
    } catch {
      // Fall through to the sanitized database response.
    }
    return databaseError(error);
  }
}
