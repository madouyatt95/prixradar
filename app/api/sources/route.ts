import { and, asc, eq, inArray, type SQL } from "drizzle-orm";

import { getDb } from "@/db";
import { sourceStatuses } from "@/db/schema";
import { isActiveSource } from "@/lib/source-registry";

export const dynamic = "force-dynamic";

const STALE_AFTER_MINUTES = 30;

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

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("D1 binding") || message.includes("env.DB")) {
    return apiError(503, "DATABASE_UNAVAILABLE", "La base d’état des sources est indisponible.");
  }
  if (message.includes("no such table")) {
    return apiError(503, "SOURCES_NOT_READY", "Le stockage d’état des sources n’est pas initialisé.");
  }
  return apiError(500, "SOURCES_FAILED", "L’état des sources ne peut pas être chargé.");
}

function serializeStatus(row: typeof sourceStatuses.$inferSelect, nowMs: number) {
  const successMs = row.lastSuccessAt === null ? Number.NaN : Date.parse(row.lastSuccessAt);
  const ageMinutes = Number.isFinite(successMs)
    ? Math.max(0, Math.round((nowMs - successMs) / 60_000))
    : null;
  const attemptMs = row.lastAttemptAt === null ? Number.NaN : Date.parse(row.lastAttemptAt);
  const lastAttemptAgeMinutes = Number.isFinite(attemptMs)
    ? Math.max(0, Math.round((nowMs - attemptMs) / 60_000))
    : null;
  const hasFreshSuccess = ageMinutes !== null && ageMinutes <= STALE_AFTER_MINUTES;
  const isStale = row.mode === "live" && row.status === "healthy" && !hasFreshSuccess;
  const effectiveStatus = isStale ? "stale" : row.status;

  return {
    id: row.id,
    source: row.source,
    market: row.market,
    displayName: row.displayName,
    mode: row.mode,
    isDemo: row.mode === "demo",
    reportedStatus: row.status,
    effectiveStatus,
    isStale,
    lastSuccessAt: row.lastSuccessAt,
    lastAttemptAt: row.lastAttemptAt,
    lastErrorCode: row.lastErrorCode,
    productsSeen: row.productsSeen,
    queueLag: row.queueLag,
    updatedAt: row.updatedAt,
    ageMinutes,
    lastAttemptAgeMinutes,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeDemo = url.searchParams.get("includeDemo") === "true";
  const source = url.searchParams.get("source")?.trim().toLowerCase() ?? null;
  if (source !== null && !isActiveSource(source)) {
    return apiError(400, "INVALID_SOURCE", "source n’est pas prise en charge.");
  }
  const market = url.searchParams.get("market")?.trim().toUpperCase() ?? null;
  if (market !== null && !/^[A-Z]{2,8}$/.test(market)) {
    return apiError(400, "INVALID_MARKET", "market est invalide.");
  }

  const visibleModes = includeDemo ? ["live", "demo"] : ["live"];
  const conditions: SQL[] = [inArray(sourceStatuses.mode, visibleModes)];
  if (source !== null) conditions.push(eq(sourceStatuses.source, source));
  if (market !== null) conditions.push(eq(sourceStatuses.market, market));

  try {
    const rows = await getDb()
      .select()
      .from(sourceStatuses)
      .where(and(...conditions))
      .orderBy(asc(sourceStatuses.source), asc(sourceStatuses.market));
    const now = new Date();
    const items = rows.map((row) => serializeStatus(row, now.getTime()));
    const liveItems = items.filter((item) => item.mode === "live");
    const overallStatus =
      liveItems.length === 0
        ? "unconfigured"
        : liveItems.every((item) => item.effectiveStatus === "healthy")
          ? "healthy"
          : "degraded";

    return json(
      {
        ok: true,
        origin: "database",
        mode: includeDemo ? "live_and_demo" : "live",
        generatedAt: now.toISOString(),
        configured: liveItems.length > 0,
        overallStatus,
        count: items.length,
        items,
      },
      200,
      true,
    );
  } catch (error) {
    return databaseError(error);
  }
}
