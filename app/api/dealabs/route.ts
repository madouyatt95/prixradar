import { and, desc, eq, gte, inArray, ne, or } from "drizzle-orm";

import { getDb } from "@/db";
import { alerts, communitySignals, inspectionRequests } from "@/db/schema";

export const dynamic = "force-dynamic";

function boundedLimit(value: string | null) {
  if (value === null) return 20;
  if (!/^\d{1,2}$/u.test(value)) throw new Error("limit invalide");
  const limit = Number(value);
  if (limit < 1 || limit > 40) throw new Error("limit doit être compris entre 1 et 40");
  return limit;
}

function parseEvidence(value: string) {
  try {
    const evidence = JSON.parse(value) as Record<string, unknown>;
    const analysis = evidence.analysis && typeof evidence.analysis === "object" ? evidence.analysis as Record<string, unknown> : null;
    const checks = analysis?.checks && typeof analysis.checks === "object" ? analysis.checks as Record<string, unknown> : null;
    return {
      secondVerification: checks?.secondVerification === true,
      reliable: evidence.notificationEligible === true,
      watch: evidence.watchNotificationEligible === true,
    };
  } catch {
    return { secondVerification: false, reliable: false, watch: false };
  }
}

function key(source: string | null, market: string | null, productId: string | null) {
  return source && market && productId ? `${source}:${market}:${productId}` : null;
}

export async function GET(request: Request) {
  let limit: number;
  try {
    limit = boundedLimit(new URL(request.url).searchParams.get("limit"));
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Filtre invalide." }, { status: 400 });
  }

  try {
    const database = getDb();
    const freshAfter = new Date(Date.now() - 12 * 60 * 60_000).toISOString();
    const rows = await database.select().from(communitySignals).where(and(
      eq(communitySignals.provider, "dealabs"),
      ne(communitySignals.status, "stale"),
      gte(communitySignals.lastSeenAt, freshAfter),
      or(gte(communitySignals.temperature, 100), eq(communitySignals.status, "new")),
    )).orderBy(
      desc(communitySignals.velocityX100),
      desc(communitySignals.temperature),
      desc(communitySignals.publishedAt),
    ).limit(limit);

    const productIds = [...new Set(rows.map((row) => row.productId).filter((value): value is string => Boolean(value)))];
    const inspectionIds = [...new Set(rows.map((row) => row.inspectionRequestId).filter((value): value is string => Boolean(value)))];
    const [matchedAlerts, inspections] = await Promise.all([
      productIds.length === 0 ? [] : database.select({
        id: alerts.id,
        source: alerts.source,
        market: alerts.market,
        productId: alerts.productId,
        status: alerts.status,
        evidenceJson: alerts.evidenceJson,
        verifiedAt: alerts.verifiedAt,
        updatedAt: alerts.updatedAt,
      }).from(alerts).where(and(
        eq(alerts.sourceMode, "live"),
        inArray(alerts.productId, productIds),
        inArray(alerts.status, ["active", "review", "monitoring"]),
      )).orderBy(desc(alerts.verifiedAt), desc(alerts.updatedAt)).limit(120),
      inspectionIds.length === 0 ? [] : database.select({
        id: inspectionRequests.id,
        status: inspectionRequests.status,
        resultJson: inspectionRequests.resultJson,
      }).from(inspectionRequests).where(inArray(inspectionRequests.id, inspectionIds)),
    ]);
    const alertByProduct = new Map<string, typeof matchedAlerts[number]>();
    for (const alert of matchedAlerts) {
      const alertKey = key(alert.source, alert.market, alert.productId);
      if (alertKey && !alertByProduct.has(alertKey)) alertByProduct.set(alertKey, alert);
    }
    const inspectionById = new Map(inspections.map((inspection) => [inspection.id, inspection]));

    return Response.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      count: rows.length,
      cadenceMinutes: 5,
      items: rows.map((row) => {
        const alert = alertByProduct.get(key(row.source, row.market, row.productId) ?? "");
        const evidence = alert ? parseEvidence(alert.evidenceJson) : null;
        const inspection = row.inspectionRequestId ? inspectionById.get(row.inspectionRequestId) : null;
        const verificationStatus = evidence?.secondVerification
          ? "confirmed"
          : alert
            ? "single_check"
            : inspection?.status === "completed"
              ? "not_anomalous"
              : inspection?.status === "failed"
                ? "failed"
                : inspection?.status === "pending" || inspection?.status === "processing"
                  ? "checking"
                  : row.merchantUrl
                    ? "queued"
                    : "unsupported";
        return {
          id: row.id,
          externalId: row.externalId,
          title: row.title,
          merchant: row.merchant,
          category: row.category,
          dealUrl: row.dealUrl,
          merchantUrl: row.merchantUrl,
          imageUrl: row.imageUrl,
          source: row.source,
          market: row.market,
          currency: row.currency,
          priceCents: row.priceCents,
          temperature: row.temperature,
          velocityPerMinute: row.velocityX100 / 100,
          momentum: row.status,
          publishedAt: row.publishedAt,
          lastSeenAt: row.lastSeenAt,
          verification: {
            status: verificationStatus,
            alertId: alert?.id ?? null,
            level: evidence?.reliable ? "reliable" : evidence?.watch ? "watch" : evidence?.secondVerification ? "confirmed" : "community",
          },
        };
      }),
    }, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=90" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const initializing = message.includes("no such table");
    return Response.json({
      ok: false,
      code: initializing ? "DEALABS_INITIALIZING" : "DEALABS_UNAVAILABLE",
      items: [],
    }, {
      status: initializing ? 503 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
