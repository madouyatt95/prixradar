import { runtimeEnv as env } from "@/lib/runtime-env";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { alerts, collectionRuns, discoverySegments, inspectionRequests, recheckRequests, sentinelFrontier, sourceConfigurations } from "@/db/schema";
import { optimizeCoverageBudgets } from "@/lib/budget-optimizer";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function equalSecret(left: string, right: string) {
  const [a, b] = await Promise.all([hash(left), hash(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function ingestSecret() {
  const worker = (env as unknown as { INGEST_SECRET?: unknown }).INGEST_SECRET;
  if (typeof worker === "string" && worker.length >= 24) return worker;
  return typeof process.env.INGEST_SECRET === "string" && process.env.INGEST_SECRET.length >= 24
    ? process.env.INGEST_SECRET
    : null;
}

function effectiveCadence(cadenceMinutes: number, volatilityScore: number) {
  if (volatilityScore >= 70) return Math.max(15, Math.floor(cadenceMinutes / 2));
  if (volatilityScore <= 20) return Math.min(1_440, cadenceMinutes * 2);
  return cadenceMinutes;
}

function categoryIds(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is number => Number.isSafeInteger(item) && item > 0))].slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const expected = ingestSecret();
  const token = /^Bearer ([^\s]{1,512})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (expected === null) return json({ ok: false, code: "INGEST_NOT_CONFIGURED" }, 503);
  if (!token || !(await equalSecret(token, expected))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);

  try {
    const database = getDb();
    const staleClaim = new Date(Date.now() - 15 * 60_000).toISOString();
    await database.update(recheckRequests).set({ status: "pending", claimedAt: null, updatedAt: new Date().toISOString() })
      .where(and(eq(recheckRequests.status, "processing"), sql`${recheckRequests.claimedAt} < ${staleClaim}`));
    await database.update(inspectionRequests).set({ status: "pending", claimedAt: null, updatedAt: new Date().toISOString() })
      .where(and(eq(inspectionRequests.status, "processing"), sql`${inspectionRequests.claimedAt} < ${staleClaim}`));
    await database.update(sentinelFrontier).set({ status: "queued", updatedAt: new Date().toISOString() })
      .where(and(eq(sentinelFrontier.status, "processing"), sql`${sentinelFrontier.updatedAt} < ${staleClaim}`));
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [rows, segments, pendingRechecks, pendingInspections, dueFrontier, runMetrics, alertMetrics] = await Promise.all([
      database
        .select()
        .from(sourceConfigurations)
        .where(eq(sourceConfigurations.enabled, true))
        .orderBy(asc(sourceConfigurations.lastRunAt), asc(sourceConfigurations.source)),
      database
        .select()
        .from(discoverySegments)
        .where(eq(discoverySegments.enabled, true))
        .orderBy(desc(discoverySegments.priority), asc(discoverySegments.lastRunAt)),
      database.select().from(recheckRequests)
        .where(eq(recheckRequests.status, "pending"))
        .orderBy(asc(recheckRequests.requestedAt)).limit(25),
      database.select().from(inspectionRequests)
        .where(eq(inspectionRequests.status, "pending"))
        .orderBy(asc(inspectionRequests.requestedAt)).limit(25),
      database.select().from(sentinelFrontier)
        .where(and(
          inArray(sentinelFrontier.status, ["queued", "active"]),
          sql`${sentinelFrontier.nextScanAt} <= ${new Date().toISOString()}`,
        ))
        .orderBy(desc(sentinelFrontier.priority), asc(sentinelFrontier.nextScanAt)).limit(50),
      database.select({
        source: collectionRuns.source,
        market: collectionRuns.market,
        productsSeen: sql<number>`coalesce(sum(${collectionRuns.productsSeen}), 0)`,
        costMicros: sql<number>`coalesce(sum(${collectionRuns.apifyCostMicros}), 0)`,
        antiBotBlocks: sql<number>`coalesce(sum(case when ${collectionRuns.antiBotBlocked} = 1 then 1 else 0 end), 0)`,
      }).from(collectionRuns).where(sql`${collectionRuns.attemptedAt} >= ${since}`).groupBy(collectionRuns.source, collectionRuns.market),
      database.select({
        source: alerts.source,
        market: alerts.market,
        exploitableAlerts: sql<number>`coalesce(sum(case when ${alerts.status} = 'active' then 1 else 0 end), 0)`,
      }).from(alerts).where(sql`${alerts.updatedAt} >= ${since}`).groupBy(alerts.source, alerts.market),
    ]);
    const runByKey = new Map(runMetrics.map((row) => [`${row.source}:${row.market}`, row]));
    const alertByKey = new Map(alertMetrics.map((row) => [`${row.source}:${row.market}`, row]));
    const retailRecommendations = new Map(optimizeCoverageBudgets(rows.map((row) => {
      const key = `${row.source}:${row.market}`;
      const run = runByKey.get(key);
      return {
        id: row.id,
        currentBudget: row.dailyProductBudget,
        productsSeen: Number(run?.productsSeen ?? 0),
        exploitableAlerts: Number(alertByKey.get(key)?.exploitableAlerts ?? 0),
        costMicros: Number(run?.costMicros ?? 0),
        antiBotBlocks: Number(run?.antiBotBlocks ?? 0),
      };
    })).map((item) => [item.id, item]));
    const now = Date.now();
    const seen = new Set<string>();
    const items = rows.flatMap((row) => {
      const cadenceMinutes = effectiveCadence(row.cadenceMinutes, row.volatilityScore);
      const due = row.lastRunAt === null || now - Date.parse(row.lastRunAt) >= cadenceMinutes * 60_000;
      const probeOnly = row.circuitState === "open";
      const cooldownElapsed = row.cooldownUntil === null || Date.parse(row.cooldownUntil) <= now;
      const normalizedUrl = row.discoveryUrl.toLowerCase().replace(/\/$/u, "");
      if (!due || seen.has(normalizedUrl) || (probeOnly && !cooldownElapsed)) return [];
      seen.add(normalizedUrl);
      const budget = retailRecommendations.get(row.id);
      return [{
        id: row.id,
        source: row.source,
        market: row.market,
        category: row.category,
        discoveryUrl: row.discoveryUrl,
        discoveryStrategy: row.discoveryStrategy,
        pageCursor: row.pageCursor,
        estimatedProductCount: row.estimatedProductCount,
        uniqueProductsSeen: row.uniqueProductsSeen,
        coveragePercent: row.coveragePercent,
        contractStatus: row.contractStatus,
        cadenceMinutes,
        volatilityScore: row.volatilityScore,
        circuitState: row.circuitState,
        probeOnly,
        productLimit: probeOnly ? 1 : budget?.recommendedBudget ?? row.dailyProductBudget,
        budgetAction: budget?.action ?? "hold",
        yieldPerThousand: budget?.yieldPerThousand ?? 0,
      }];
    });
    const discoveryItems = segments.flatMap((segment) => {
      const due = segment.lastRunAt === null || now - Date.parse(segment.lastRunAt) >= segment.cadenceMinutes * 60_000;
      if (!due) return [];
      const runsPerDay = Math.max(1, Math.ceil(1_440 / segment.cadenceMinutes));
      const perRunLimit = Math.max(1, Math.min(100, Math.floor(segment.dailyTokenBudget / runsPerDay)));
      const page = Math.floor(now / (segment.cadenceMinutes * 60_000)) % 10;
      return [{
        id: segment.id,
        source: "amazon" as const,
        market: segment.market,
        label: segment.label,
        categoryIds: categoryIds(segment.categoryIdsJson),
        minPriceCents: segment.minPriceCents,
        maxPriceCents: segment.maxPriceCents,
        minimumDropPercent: segment.minimumDropPercent,
        limit: perRunLimit,
        page,
        priority: segment.priority,
        dailyTokenBudget: segment.dailyTokenBudget,
      }];
    });
    if (discoveryItems.length > 0) {
      const claimedAt = new Date(now).toISOString();
      for (const segment of discoveryItems) {
        await database.update(discoverySegments).set({ lastRunAt: claimedAt, updatedAt: claimedAt })
          .where(eq(discoverySegments.id, segment.id));
      }
    }
    const recheckItems = pendingRechecks.map((row) => ({
      id: row.id,
      alertId: row.alertId,
      source: row.source,
      market: row.market,
      url: row.url,
    }));
    if (recheckItems.length > 0) {
      const claimedAt = new Date(now).toISOString();
      await database.update(recheckRequests).set({ status: "processing", claimedAt, updatedAt: claimedAt })
        .where(and(
          inArray(recheckRequests.id, recheckItems.map((item) => item.id)),
          eq(recheckRequests.status, "pending"),
        ));
    }
    const inspectionItems = pendingInspections.map((row) => ({
      id: row.id,
      source: row.source,
      market: row.market,
      url: row.url,
      shadowCart: true,
    }));
    if (inspectionItems.length > 0) {
      const claimedAt = new Date(now).toISOString();
      await database.update(inspectionRequests).set({ status: "processing", claimedAt, updatedAt: claimedAt })
        .where(and(
          inArray(inspectionRequests.id, inspectionItems.map((item) => item.id)),
          eq(inspectionRequests.status, "pending"),
        ));
    }
    const frontierItems = dueFrontier.map((row) => ({
      id: row.id,
      source: row.source,
      market: row.market,
      url: row.url,
      priority: row.priority,
      depth: row.depth,
      shadowCart: row.priority >= 70,
    }));
    if (frontierItems.length > 0) {
      const claimedAt = new Date(now).toISOString();
      await database.update(sentinelFrontier).set({ status: "processing", updatedAt: claimedAt })
        .where(inArray(sentinelFrontier.id, frontierItems.map((item) => item.id)));
    }
    return json({
      ok: true,
      generatedAt: new Date(now).toISOString(),
      count: items.length,
      items,
      discoveryCount: discoveryItems.length,
      discoverySegments: discoveryItems,
      budgetRecommendations: [...retailRecommendations.values()],
      recheckCount: recheckItems.length,
      rechecks: recheckItems,
      inspectionCount: inspectionItems.length,
      inspections: inspectionItems,
      frontierCount: frontierItems.length,
      frontier: frontierItems,
    });
  } catch {
    return json({ ok: false, code: "SOURCE_PLAN_UNAVAILABLE" }, 503);
  }
}
