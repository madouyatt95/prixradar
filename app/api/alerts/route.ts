import { and, desc, eq, gt, gte, inArray, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import { runtimeEnv as env } from "@/lib/runtime-env";

import { getDb } from "@/db";
import { alertFeedback, alertIntelligence, alerts, priceObservations } from "@/db/schema";
import { ANOMALY_LIMITS, type AnomalyEvaluation } from "@/lib/anomaly";
import { NON_AMAZON_EXTREME_DISCOUNT_PERCENT } from "@/lib/deal-policy";
import { assessPurchasability } from "@/lib/purchasability";
import { buildPriceInsight } from "@/lib/price-insight";
import { sellerChannel } from "@/lib/seller-channel";
import { isActiveSource } from "@/lib/source-registry";

export const dynamic = "force-dynamic";

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
      watchNotificationEligible?: unknown;
      categoryListingWatchEligible?: unknown;
      broadWatchEligible?: unknown;
      alertLevel?: unknown;
      priceReference?: {
        source?: unknown;
        amountCents?: unknown;
        merchantDisplayed?: unknown;
      };
      analysis?: Partial<AnomalyEvaluation>;
    };
    if (!parsed || typeof parsed !== "object") return null;
    const analysis = parsed.analysis;
    return {
      notificationEligible: parsed.notificationEligible === true,
      watchNotificationEligible: parsed.watchNotificationEligible === true,
      categoryListingWatchEligible: parsed.categoryListingWatchEligible === true,
      broadWatchEligible: parsed.broadWatchEligible === true,
      alertLevel: parsed.alertLevel === "reliable" || parsed.alertLevel === "watch" ? parsed.alertLevel : "none",
      secondVerification: analysis?.checks?.secondVerification === true,
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
      baselineSource: typeof analysis?.baselineSource === "string" ? analysis.baselineSource : null,
      priceReference: {
        source: typeof parsed.priceReference?.source === "string" ? parsed.priceReference.source : "unknown",
        amountCents: typeof parsed.priceReference?.amountCents === "number" ? parsed.priceReference.amountCents : null,
        merchantDisplayed: parsed.priceReference?.merchantDisplayed === true,
      },
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

function parseJsonObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function serializeIntelligence(row?: typeof alertIntelligence.$inferSelect) {
  if (!row) return null;
  return {
    variant: { ...parseJsonObject(row.variantJson), fingerprint: row.variantFingerprint, confidence: row.variantConfidence },
    shadowCart: { ...parseJsonObject(row.shadowCartJson), status: row.shadowCartStatus, finalTotalCents: row.finalTotalCents },
    priceIndex: { ...parseJsonObject(row.priceIndexJson), medianCents: row.priceIndexCents, marketPosition: row.marketPosition },
    anomaly: { ...parseJsonObject(row.anomalyJson), kind: row.anomalyKind },
    seller: { ...parseJsonObject(row.sellerJson), score: row.sellerScore },
    lifetime: {
      urgencyScore: row.urgencyScore,
      predictedLifetimeMinutes: row.predictedLifetimeMinutes,
      predictedExpiresAt: row.predictedExpiresAt,
    },
    updatedAt: row.updatedAt,
  };
}

type PublicHistoryPoint = Pick<
  typeof priceObservations.$inferSelect,
  "priceCents" | "shippingCents" | "totalCents" | "available" | "observedAt"
>;

type PublicComparison = {
  id: string;
  canonicalProductId: string | null;
  source: string;
  merchant: string;
  market: string;
  title: string;
  gtin: string | null;
  url: string;
  currency: string;
  publicPriceCents: number | null;
  observedAt: string;
  seller: string | null;
};

function serializeAlert(
  row: typeof alerts.$inferSelect,
  community?: CommunitySummary,
  intelligence?: typeof alertIntelligence.$inferSelect,
  history: PublicHistoryPoint[] = [],
  comparisons: PublicComparison[] = [],
) {
  const evidence = parseEvidence(row.evidenceJson);
  const totalCents = intelligence?.finalTotalCents ?? (row.shippingCents === null ? null : row.priceCents + row.shippingCents);
  const priceInsight = buildPriceInsight({
    currentTotalCents: totalCents,
    observedAt: row.observedAt,
    history: history.map((point) => ({
      totalCents: point.totalCents ?? (point.shippingCents === null ? point.priceCents : point.priceCents + point.shippingCents),
      observedAt: point.observedAt,
      available: point.available,
    })),
    fallbackBaselineCents: row.usualPriceCents,
  });
  const effectiveScore = priceInsight.classification === "normal_price"
    ? Math.min(row.score, 39)
    : priceInsight.classification === "stable_good_price"
      ? Math.min(row.score, 59)
      : row.score;
  const liveEligible =
    row.sourceMode === "live" &&
    row.status === "active" &&
    row.verifiedAt !== null &&
    evidence?.notificationEligible === true &&
    !priceInsight.shouldAutoClose &&
    (priceInsight.classification === "probable_error" || priceInsight.classification === "recent_drop");
  const watchEligible =
    row.sourceMode === "live" &&
    (row.status === "review" || row.status === "monitoring") &&
    evidence?.watchNotificationEligible === true &&
    !priceInsight.shouldAutoClose;
  let affiliateUrl: string | null = null;
  const tag = (env as unknown as { AMAZON_ASSOCIATE_TAG?: unknown }).AMAZON_ASSOCIATE_TAG ?? process.env.AMAZON_ASSOCIATE_TAG;
  if (row.source === "amazon" && typeof tag === "string" && /^[A-Za-z0-9-]{3,40}$/.test(tag)) {
    const url = new URL(row.url);
    url.searchParams.set("tag", tag);
    affiliateUrl = url.toString();
  }
  const parsedBuyNow = parseBuyNow(row.buyNowJson, row.buyNowScore);
  const buyNow = {
    ...parsedBuyNow,
    score: priceInsight.classification === "normal_price"
      ? Math.min(parsedBuyNow.score, 35)
      : priceInsight.classification === "stable_good_price"
        ? Math.min(parsedBuyNow.score, 59)
        : parsedBuyNow.score,
    label: priceInsight.classification === "normal_price"
      ? "Prix habituel"
      : priceInsight.classification === "stable_good_price" ? "Bon prix sans urgence" : parsedBuyNow.label,
  };
  const sellerIntelligence = intelligence ? parseJsonObject(intelligence.sellerJson) : {};
  const sellerSignals = sellerIntelligence.signals && typeof sellerIntelligence.signals === "object" && !Array.isArray(sellerIntelligence.signals)
    ? sellerIntelligence.signals as Record<string, unknown>
    : {};
  const fulfillment = typeof sellerSignals.fulfillment === "string" ? sellerSignals.fulfillment : null;
  const channel = sellerChannel({ source: row.source, merchant: row.merchant, seller: row.seller, fulfillment });
  const purchasability = assessPurchasability({
    sourceMode: row.sourceMode,
    status: row.status,
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
    totalCents,
    priceAccessibleToAll: row.priceAccessibleToAll,
    cartStatus: intelligence?.shadowCartStatus,
    variantConfidence: intelligence?.variantConfidence,
    sellerScore: intelligence?.sellerScore,
    communityPositive: community?.positive,
    communityNegative: community?.negative,
  });
  const comparableBySource = new Map<string, PublicComparison>();
  for (const comparison of comparisons) {
    if (comparison.id === row.id || comparison.currency !== row.currency || comparison.publicPriceCents === null) continue;
    const key = `${comparison.source}:${comparison.market}`;
    const previous = comparableBySource.get(key);
    if (!previous || Date.parse(comparison.observedAt) > Date.parse(previous.observedAt)) comparableBySource.set(key, comparison);
  }
  const comparableOffers = [...comparableBySource.values()]
    .sort((left, right) => (left.publicPriceCents ?? Number.MAX_SAFE_INTEGER) - (right.publicPriceCents ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 8)
    .map((comparison) => ({
      alertId: comparison.id,
      source: comparison.source,
      merchant: comparison.merchant,
      market: comparison.market,
      title: comparison.title,
      url: comparison.url,
      priceCents: comparison.publicPriceCents,
      seller: comparison.seller,
      observedAt: comparison.observedAt,
      match: row.gtin && comparison.gtin === row.gtin ? "EAN exact" : "Modèle rapproché",
    }));
  const merchantReferenceCents = evidence?.priceReference.merchantDisplayed === true
    && evidence.priceReference.amountCents !== null
    && evidence.priceReference.amountCents > (totalCents ?? row.priceCents)
    ? evidence.priceReference.amountCents
    : null;
  const priceReference = merchantReferenceCents !== null
    ? { kind: "merchant" as const, amountCents: merchantReferenceCents, label: "Prix barré affiché par l’enseigne", crossedOut: true }
    : priceInsight.baselineCents !== null && priceInsight.baselineCents > (totalCents ?? row.priceCents)
      ? { kind: "historical" as const, amountCents: priceInsight.baselineCents, label: "Prix habituel estimé sur 90 jours", crossedOut: false }
      : { kind: "unavailable" as const, amountCents: null, label: "Référence insuffisante", crossedOut: false };

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
    totalCents,
    usualPriceCents: priceInsight.baselineCents ?? row.usualPriceCents,
    discountPercent: Math.max(0, Math.round(priceInsight.discountPercent)),
    score: effectiveScore,
    buyNow,
    confidence: row.confidence,
    status: row.status,
    alertLevel: liveEligible ? "reliable" : watchEligible ? "watch" : evidence?.alertLevel ?? "none",
    notificationEligible: liveEligible,
    watchNotificationEligible: watchEligible,
    verification: {
      level: evidence?.secondVerification === true ? "double" : "single",
      count: evidence?.secondVerification === true ? 2 : 1,
      secondCheckConfirmed: evidence?.secondVerification === true,
      label: evidence?.secondVerification === true ? "2/2 vérifications" : "1/2 vérifications",
    },
    seller: row.seller,
    sellerChannel: channel,
    sellerChannelLabel: channel === "third_party" ? "Vendeur tiers" : "Enseigne",
    sellerTrusted: sellerSignals.trusted === true,
    sellerFulfillment: fulfillment,
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
    priceReference,
    priceInsight,
    comparableOffers,
    certificateUrl: liveEligible ? `/certified/${encodeURIComponent(row.id)}` : null,
    certificateApiUrl: liveEligible ? `/api/certified/${encodeURIComponent(row.id)}` : null,
    history: row.sourceMode === "live" ? {
      mode: "live",
      count: Math.min(history.length, 60),
      truncated: history.length > 60,
      points: history.slice(0, 60).map((point) => ({
        observedAt: point.observedAt,
        priceCents: point.priceCents,
        shippingCents: point.shippingCents,
        totalCents: point.totalCents,
        available: point.available,
      })),
    } : {
      mode: "unavailable",
      count: 0,
      truncated: false,
      points: [],
      reason: "demo_data",
    },
    community: community ?? { total: 0, positive: 0, negative: 0, expired: 0, purchased: 0 },
    purchasability,
    intelligence: serializeIntelligence(intelligence),
    evidence: evidence === null ? null : {
      historyPoints: evidence.historyPoints,
      madCents: evidence.madCents,
      robustZ: evidence.robustZ,
      freshnessMinutes: evidence.freshnessMinutes,
      secondVerification: evidence.secondVerification,
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
  const view = url.searchParams.get("view")?.trim() ?? "confirmed";
  if (view !== "confirmed" && view !== "single_check") {
    return apiError(400, "INVALID_VIEW", "view doit être confirmed ou single_check.");
  }
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
      view === "single_check" ? 0 : 35,
      0,
      100,
    );
    maxPrice = boundedInteger(url.searchParams.get("maxPriceCents"), "maxPriceCents", 100_000_000, 1, 100_000_000);
  } catch (error) {
    return apiError(400, "INVALID_FILTER", error instanceof Error ? error.message : "Filtre invalide.");
  }

  const includeDemo = url.searchParams.get("includeDemo") === "true";
  const source = url.searchParams.get("source")?.trim().toLowerCase() ?? null;
  if (source !== null && !isActiveSource(source)) {
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
  const accessibleOnly = url.searchParams.has("accessibleOnly")
    ? url.searchParams.get("accessibleOnly") !== "false"
    : view !== "single_check";

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
  const singleCheckVisibility = and(
    eq(alerts.sourceMode, "live"),
    inArray(alerts.status, ["review", "monitoring"]),
    isNotNull(alerts.expiresAt),
    gt(alerts.expiresAt, now),
    gte(alerts.observedAt, freshAfter),
    sql`json_extract(${alerts.evidenceJson}, '$.analysis.checks.secondVerification') = 0`,
  );
  const jdSportsNonAccessory = sql`not (
    ${alerts.source} = 'jd_sports' and (
      lower(coalesce(${alerts.category}, '')) like '%accessoir%'
      or lower(${alerts.title}) like '%chaussette%'
      or lower(${alerts.title}) like '%socks%'
      or lower(${alerts.title}) like '%boxer%'
      or lower(${alerts.title}) like '%sacoche%'
      or lower(${alerts.title}) like '%casquette%'
      or lower(${alerts.title}) like '%portefeuille%'
      or lower(${alerts.title}) like '%sac à dos%'
    )
  )`;
  const publicDealPolicy = or(
    eq(alerts.source, "amazon"),
    and(
      gte(alerts.discountPercent, NON_AMAZON_EXTREME_DISCOUNT_PERCENT),
      gt(alerts.usualPriceCents, alerts.priceCents),
      jdSportsNonAccessory,
    ),
  );
  const watchVisibility = and(
    eq(alerts.sourceMode, "live"),
    inArray(alerts.status, ["review", "monitoring"]),
    isNotNull(alerts.expiresAt),
    gt(alerts.expiresAt, now),
    gte(alerts.observedAt, freshAfter),
    sql`json_extract(${alerts.evidenceJson}, '$.watchNotificationEligible') = 1`,
    or(
      and(eq(alerts.source, "amazon"), gte(alerts.discountPercent, ANOMALY_LIMITS.minDiscountPercent), gte(alerts.score, 35)),
      and(gte(alerts.discountPercent, NON_AMAZON_EXTREME_DISCOUNT_PERCENT), gt(alerts.usualPriceCents, alerts.priceCents)),
    ),
  );
  const visibility = view === "single_check"
    ? singleCheckVisibility
    : includeDemo
    ? or(
        liveEligibility,
        watchVisibility,
        and(eq(alerts.sourceMode, "demo"), isNotNull(alerts.expiresAt), gt(alerts.expiresAt, now)),
      )
    : or(liveEligibility, watchVisibility);
  const dealVisibility = includeDemo
    ? or(eq(alerts.sourceMode, "demo"), publicDealPolicy)
    : publicDealPolicy;
  const conditions: SQL[] = [visibility as SQL, dealVisibility as SQL, gte(alerts.discountPercent, minDiscount), gte(alerts.score, minScore)];
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
    const canonicalIds = [...new Set(rows.map((row) => row.canonicalProductId).filter((id): id is string => id !== null))];
    const [feedbackRows, intelligenceRows, observationRows, comparisonRows] = rows.length === 0 ? [[], [], [], []] : await Promise.all([
      database.select({
        alertId: alertFeedback.alertId,
        total: sql<number>`count(*)`,
        positive: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} in ('useful', 'purchased', 'price_confirmed') then 1 else 0 end), 0)`,
        negative: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} in ('false_positive', 'cancelled', 'wrong_variant', 'coupon_failed') then 1 else 0 end), 0)`,
        expired: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'expired' then 1 else 0 end), 0)`,
        purchased: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'purchased' then 1 else 0 end), 0)`,
      }).from(alertFeedback).where(inArray(alertFeedback.alertId, rows.map((row) => row.id))).groupBy(alertFeedback.alertId),
      database.select().from(alertIntelligence).where(inArray(alertIntelligence.alertId, rows.map((row) => row.id))),
      database.select({
        alertId: priceObservations.alertId,
        priceCents: priceObservations.priceCents,
        shippingCents: priceObservations.shippingCents,
        totalCents: priceObservations.totalCents,
        available: priceObservations.available,
        observedAt: priceObservations.observedAt,
      }).from(priceObservations)
        .where(inArray(priceObservations.alertId, rows.filter((row) => row.sourceMode === "live").map((row) => row.id)))
        .orderBy(desc(priceObservations.observedAt)),
      canonicalIds.length === 0 ? Promise.resolve([]) : database.select({
        id: alerts.id,
        canonicalProductId: alerts.canonicalProductId,
        source: alerts.source,
        merchant: alerts.merchant,
        market: alerts.market,
        title: alerts.title,
        gtin: alerts.gtin,
        url: alerts.url,
        currency: alerts.currency,
        publicPriceCents: alerts.publicPriceCents,
        observedAt: alerts.observedAt,
        seller: alerts.seller,
      }).from(alerts).where(and(
        inArray(alerts.canonicalProductId, canonicalIds),
        eq(alerts.sourceMode, "live"),
        inArray(alerts.status, ["active", "review", "monitoring"]),
        eq(alerts.priceAccessibleToAll, true),
        isNotNull(alerts.publicPriceCents),
        gte(alerts.observedAt, new Date(nowMs - 7 * 86_400_000).toISOString()),
      )).orderBy(desc(alerts.observedAt)).limit(250),
    ]);
    const community = new Map(feedbackRows.map((row) => [row.alertId, {
      total: Number(row.total), positive: Number(row.positive), negative: Number(row.negative),
      expired: Number(row.expired), purchased: Number(row.purchased),
    }]));
    const intelligence = new Map(intelligenceRows.map((row) => [row.alertId, row]));
    const history = new Map<string, PublicHistoryPoint[]>();
    for (const observation of observationRows) {
      const points = history.get(observation.alertId) ?? [];
      if (points.length < 61) points.push(observation);
      history.set(observation.alertId, points);
    }
    const comparisons = new Map<string, PublicComparison[]>();
    for (const comparison of comparisonRows) {
      if (!comparison.canonicalProductId) continue;
      const items = comparisons.get(comparison.canonicalProductId) ?? [];
      items.push(comparison);
      comparisons.set(comparison.canonicalProductId, items);
    }
    const serialized = rows
      .map((row) => serializeAlert(
        row,
        community.get(row.id),
        intelligence.get(row.id),
        history.get(row.id),
        row.canonicalProductId ? comparisons.get(row.canonicalProductId) : undefined,
      ))
      .filter((item) =>
        view === "single_check"
        || item.source === "jd_sports"
        || item.priceInsight.classification !== "normal_price"
      );

    return json(
      {
        ok: true,
        mode: view === "single_check" ? "single_check" : includeDemo ? "live_and_demo" : "live",
        generatedAt: now,
        count: serialized.length,
        items: serialized,
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
