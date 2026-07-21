import { and, desc, eq, gt, gte, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { alerts } from "@/db/schema";
import { ANOMALY_LIMITS, type AnomalyEvaluation } from "@/lib/anomaly";

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
    };
  } catch {
    return null;
  }
}

function serializeAlert(row: typeof alerts.$inferSelect) {
  const evidence = parseEvidence(row.evidenceJson);
  const liveEligible =
    row.sourceMode === "live" &&
    row.status === "active" &&
    row.verifiedAt !== null &&
    evidence?.notificationEligible === true;

  return {
    id: row.id,
    source: row.source,
    sourceMode: row.sourceMode,
    isDemo: row.sourceMode === "demo",
    merchant: row.merchant,
    market: row.market,
    productId: row.productId,
    title: row.title,
    url: row.url,
    currency: row.currency,
    priceCents: row.priceCents,
    shippingCents: row.shippingCents,
    shippingKnown: row.shippingCents !== null,
    totalCents: row.shippingCents === null ? null : row.priceCents + row.shippingCents,
    usualPriceCents: row.usualPriceCents,
    discountPercent: row.discountPercent,
    score: row.score,
    confidence: row.confidence,
    status: row.status,
    notificationEligible: liveEligible,
    seller: row.seller,
    condition: row.condition,
    observedAt: row.observedAt,
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
    evidence: evidence === null ? null : {
      historyPoints: evidence.historyPoints,
      madCents: evidence.madCents,
      robustZ: evidence.robustZ,
      freshnessMinutes: evidence.freshnessMinutes,
      blockingReasons: evidence.blockingReasons,
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
    sql`json_extract(${alerts.evidenceJson}, '$.notificationEligible') = 1`,
  );
  const visibility = includeDemo
    ? or(
        liveEligibility,
        and(eq(alerts.sourceMode, "demo"), isNotNull(alerts.expiresAt), gt(alerts.expiresAt, now)),
      )
    : liveEligibility;
  const conditions: SQL[] = [visibility as SQL, gte(alerts.discountPercent, minDiscount), gte(alerts.score, minScore)];
  if (source !== null) conditions.push(eq(alerts.source, source));
  if (market !== null) conditions.push(eq(alerts.market, market));
  if (confidence !== null) conditions.push(eq(alerts.confidence, confidence));
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

    return json(
      {
        ok: true,
        mode: includeDemo ? "live_and_demo" : "live",
        generatedAt: now,
        count: rows.length,
        items: rows.map(serializeAlert),
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
