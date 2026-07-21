import { and, desc, eq, gt, gte, inArray, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import { runtimeEnv as env } from "@/lib/runtime-env";

import { getDb } from "@/db";
import { alertFeedback, alerts } from "@/db/schema";
import { ANOMALY_LIMITS, type AnomalyEvaluation } from "@/lib/anomaly";
import { externalResearchLinks } from "@/lib/external-research";

export const dynamic = "force-dynamic";

const SOURCES = new Set(["amazon", "boulanger", "cdiscount", "darty"]);
const CONFIDENCE = new Set(["very_likely", "likely", "review", "insufficient"]);
const MAX_ALERT_AGE_MS = 120 * 60_000;

function json(body: unknown, status = 200, cache = false) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": cache ? "public, max-age=15, stale-while-revalidate=45" : "no-store",
    },
  });
}

function apiError(status: number, code: string, message: string) {
  return json({ ok: false, code, message }, status);
}

function boundedInteger(value: string | null, field: string, fallback: number, minimum: number, maximum: number) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${field} doit être un entier.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} doit être compris entre ${minimum} et ${maximum}.`);
  }
  return parsed;
}

function parseEvidence(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      notificationEligible?: unknown;
      analysis?: Partial<AnomalyEvaluation>;
    };
    if (!parsed || typeof parsed !== "object") return null;
    const analysis = parsed.analysis;
    return {
      notificationEligible: parsed.notificationEligible === true,
      historyPoints: typeof analysis?.historyPoints === "number" ? analysis.historyPoints : null,
      madCents: typeof analysis?.madCents === "number" ? analysis.madCents : null,
      robustZ: typeof analysis?.robustZ === "number" ? analysis.robustZ : null,
      freshnessMinutes: typeof analysis?.freshnessMinutes === "number" ? analysis.freshnessMinutes : null,
      blockingReasons: Array.isArray(analysis?.blockingReasons)
        ? analysis.blockingReasons.filter((reason): reason is string => typeof reason === "string").slice(0, 20)
        : [],
      marketMedianCents: typeof analysis?.marketMedianCents === "number" ? analysis.marketMedianCents : null,
      marketSources: typeof analysis?.marketSources === "number" ? analysis.marketSources : 0,
      marketDiscountPercent: typeof analysis?.marketDiscountPercent === "number" ? analysis.marketDiscountPercent : null,
    };
  } catch {
    return null;
  }
}

type CommunitySummary = {
  total: number;
  positive: number;
  negative: number;
  expired: number;
  purchased: number;
};

function parseBuyNow(value: string, fallbackScore: number) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      score: typeof parsed.score === "number" ? parsed.score : fallbackScore,
      label: typeof parsed.label === "string" ? parsed.label : "À considérer",
      factors: Array.isArray(parsed.factors) ? parsed.factors : [],
      cautions: Array.isArray(parsed.cautions) ? parsed.cautions : [],
    };
  } catch {
    return { score: fallbackScore, label: "À considérer", factors: [], cautions: [] };
  }
}

function serializeAlert(row: typeof alerts.$inferSelect, community?: CommunitySummary) {
  const evidence = parseEvidence(row.evidenceJson);
  const liveEligible =
    row.sourceMode === "live" &&
    row.status === "active" &&
    row.verifiedAt !== null &&
    evidence?.notificationEligible === true;
  let affiliateUrl: string | null = null;
  const tag = (env as unknown as { AMAZON_ASSOCIATE_TAG?: unknown }).AMAZON_ASSOCIATE_TAG ?? process.env.AMAZON_ASSOCIATE_TAG;
  if (row.source === "amazon" && typeof tag === "string" && /^[A-Za-z0-9-]{3,40}$/.test(tag)) {
    const url = new URL(row.url);
    url.searchParams.set("tag", tag);
    affiliateUrl = url.toString();
  }
  const externalResearch = externalResearchLinks(row);
  const buyNow = parseBuyNow(row.buyNowJson, row.buyNowScore);

  return {
    id: row.id,
    source: row.source,
    sourceMode: row.sourceMode,
    isDemo: row.sourceMode === "demo",
    merchant: row.merchant,
    market: row.market,
    productId: row.productId,
    canonicalProductId: row.canonicalProductId,
    identityKey: row.identityKey,
    title: row.title,
    brand: row.brand,
    model: row.model,
    gtin: row.gtin,
    category: row.category,
    url: row.url,
    affiliateUrl,
    currency: row.currency,
    priceCents: row.priceCents,
    shippingCents: row.shippingCents,
    shippingKnown: row.shippingCents !== null,
    totalCents: row.shippingCents === null ? null : row.priceCents + row.shippingCents,
    usualPriceCents: row.usualPriceCents,
    discountPercent: row.discountPercent,
    score: row.score,
    buyNow,
    confidence: row.confidence,
    status: row.status,
    notificationEligible: liveEligible,
    seller: row.seller,
    condition: row.condition,
    publicPriceCents: row.publicPriceCents,
    priceAccessibleToAll: row.priceAccessibleToAll,
    promotionType: row.promotionType,
    promotionLabel: row.promotionLabel,
    deliveryContext: {
      country: row.deliveryCountry,
      postalPrefix: row.deliveryPostalPrefix,
      mode: row.deliveryMode,
      verified: row.locationVerified,
    },
    observedAt: row.observedAt,
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
    community: community ?? { total: 0, positive: 0, negative: 0, expired: 0, purchased: 0 },
    externalResearch,
    evidence: evidence === null ? null : {
      historyPoints: evidence.historyPoints,
      madCents: evidence.madCents,
      robustZ: evidence.robustZ,
      freshnessMinutes: evidence.freshnessMinutes,
      blockingReasons: evidence.blockingReasons,
      marketMedianCents: evidence.marketMedianCents,
      marketSources: evidence.marketSources,
      marketDiscountPercent: evidence.marketDiscountPercent,
    },
  };
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("D1 binding") || message.includes("env.DB")) {
    return apiError(503, "DATABASE_UNAVAILABLE", "La base des alertes est indisponible.");
  }
  if (message.includes("no such table")) {
    return apiError(503, "ALERTS_NOT_READY", "Le stockage des alertes n’est pas encore initialisé.");
  }
  return apiError(500, "ALERTS_FAILED", "Les alertes ne peuvent pas être chargées pour le moment.");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  let limit: number;
  let offset: number;
  let minDiscount: number;
  let minScore: number;
  let maxPrice: number;

  try {
    limit = boundedInteger(url.searchParams.get("limit"), "limit", 20, 1, 50);
    offset = boundedInteger(url.searchParams.get("offset"), "offset", 0, 0, 5_000);
    minDiscount = boundedInteger(url.searchParams.get("minDiscount"), "minDiscount", 0, 0, 100);
    minScore = boundedInteger(
      url.searchParams.get("minScore"),
      "minScore",
      ANOMALY_LIMITS.minNotificationScore,
      0,
      100,
    );
    maxPrice = boundedInteger(url.searchParams.get("maxPriceCents"), "maxPriceCents", 100_000_000, 1, 100_000_000);
  } catch (error) {
    return apiError(400, "INVALID_FILTER", error instanceof Error ? error.message : "Filtre invalide.");
  }

  const includeDemo = url.searchParams.get("includeDemo") === "true";
  const source = url.searchParams.get("source")?.trim().toLowerCase() ?? null;
  if (source !== null && !SOURCES.has(source)) {
    return apiError(400, "INVALID_SOURCE", "source n’est pas prise en charge.");
  }
  const market = url.searchParams.get("market")?.trim().toUpperCase() ?? null;
  if (market !== null && !/^[A-Z]{2,8}$/.test(market)) {
    return apiError(400, "INVALID_MARKET", "market est invalide.");
  }
  const confidence = url.searchParams.get("confidence")?.trim() ?? null;
  if (confidence !== null && !CONFIDENCE.has(confidence)) {
    return apiError(400, "INVALID_CONFIDENCE", "confidence est invalide.");
  }
  const category = url.searchParams.get("category")?.trim() ?? null;
  if (category !== null && (!category || category.length > 80)) {
    return apiError(400, "INVALID_CATEGORY", "category est invalide.");
  }
  const accessibleOnly = url.searchParams.get("accessibleOnly") !== "false";

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const freshAfter = new Date(nowMs - MAX_ALERT_AGE_MS).toISOString();
  const liveEligibility = and(
    eq(alerts.sourceMode, "live"),
    eq(alerts.status, "active"),
    isNotNull(alerts.verifiedAt),
    isNotNull(alerts.expiresAt),
    isNotNull(alerts.shippingCents),
    gt(alerts.expiresAt, now),
    gte(alerts.observedAt, freshAfter),
    gte(alerts.verifiedAt, freshAfter),
    gte(alerts.score, ANOMALY_LIMITS.minNotificationScore),
    inArray(alerts.confidence, ["very_likely", "likely"]),
    eq(alerts.priceAccessibleToAll, true),
    sql`json_extract(${alerts.evidenceJson}, '$.notificationEligible') = 1`,
  );
  const visibility = includeDemo
    ? or(
        liveEligibility,
        and(eq(alerts.sourceMode, "demo"), isNotNull(alerts.expiresAt), gt(alerts.expiresAt, now)),
      )
    : liveEligibility;
  const conditions: SQL[] = [visibility as SQL, gte(alerts.discountPercent, minDiscount), gte(alerts.score, minScore)];
  conditions.push(lte(alerts.publicPriceCents, maxPrice));
  if (accessibleOnly) conditions.push(eq(alerts.priceAccessibleToAll, true));
  if (source !== null) conditions.push(eq(alerts.source, source));
  if (market !== null) conditions.push(eq(alerts.market, market));
  if (confidence !== null) conditions.push(eq(alerts.confidence, confidence));
  if (category !== null) conditions.push(eq(alerts.category, category));
  const where = and(...conditions);

  try {
    const database = getDb();
    const [rows, countRows] = await Promise.all([
      database
        .select()
        .from(alerts)
        .where(where)
        .orderBy(desc(alerts.score), desc(alerts.observedAt), desc(alerts.id))
        .limit(limit)
        .offset(offset),
      database.select({ count: sql<number>`count(*)` }).from(alerts).where(where),
    ]);
    const total = Number(countRows[0]?.count ?? 0);
    const feedbackRows = rows.length === 0 ? [] : await database.select({
      alertId: alertFeedback.alertId,
      total: sql<number>`count(*)`,
      positive: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} in ('useful', 'purchased', 'price_confirmed') then 1 else 0 end), 0)`,
      negative: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} in ('false_positive', 'cancelled', 'wrong_variant', 'coupon_failed') then 1 else 0 end), 0)`,
      expired: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'expired' then 1 else 0 end), 0)`,
      purchased: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'purchased' then 1 else 0 end), 0)`,
    }).from(alertFeedback).where(inArray(alertFeedback.alertId, rows.map((row) => row.id))).groupBy(alertFeedback.alertId);
    const community = new Map(feedbackRows.map((row) => [row.alertId, {
      total: Number(row.total), positive: Number(row.positive), negative: Number(row.negative),
      expired: Number(row.expired), purchased: Number(row.purchased),
    }]));

    return json(
      {
        ok: true,
        mode: includeDemo ? "live_and_demo" : "live",
        generatedAt: now,
        count: rows.length,
        items: rows.map((row) => serializeAlert(row, community.get(row.id))),
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + rows.length < total,
          nextOffset: offset + rows.length < total ? offset + rows.length : null,
        },
      },
      200,
      true,
    );
  } catch (error) {
    return databaseError(error);
  }
}
