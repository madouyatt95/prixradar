import { runtimeEnv as env } from "@/lib/runtime-env";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { alerts, collectionRuns, discoverySegments, eanScanRequests, inspectionRequests, merchantProducts, purchases, recheckRequests, sentinelFrontier, sourceConfigurations } from "@/db/schema";
import { optimizeCoverageBudgets } from "@/lib/budget-optimizer";
import { ACTIVE_SOURCE_IDS, isActiveSource, isPartnerSourceAuthorized, isPublicWebSource } from "@/lib/source-registry";

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

function authorizedPartnerSources() {
  const value = (env as unknown as { AUTHORIZED_PARTNER_SOURCES?: unknown }).AUTHORIZED_PARTNER_SOURCES;
  return typeof value === "string" ? value : undefined;
}

function effectiveCadence(source: string, cadenceMinutes: number, volatilityScore: number) {
  const adjusted = volatilityScore >= 70
    ? Math.max(15, Math.floor(cadenceMinutes / 2))
    : volatilityScore <= 20 ? Math.min(1_440, cadenceMinutes * 2) : cadenceMinutes;
  if (source === "jd_sports") return Math.max(30, adjusted);
  return isPublicWebSource(source) ? Math.max(60, adjusted) : adjusted;
}

const DEFAULT_EXCLUDED_FAMILIES = ["books", "music", "media", "wall_art"] as const;

function categoryConfiguration(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    const includeValue = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { include?: unknown }).include)
        ? (parsed as { include: unknown[] }).include
        : [];
    const excludeValue = parsed && typeof parsed === "object" && Array.isArray((parsed as { excludeFamilies?: unknown }).excludeFamilies)
      ? (parsed as { excludeFamilies: unknown[] }).excludeFamilies
      : DEFAULT_EXCLUDED_FAMILIES;
    const allowed = new Set<string>(DEFAULT_EXCLUDED_FAMILIES);
    return {
      include: [...new Set(includeValue.filter((item): item is number => Number.isSafeInteger(item) && item > 0))].slice(0, 20),
      excludeFamilies: [...new Set(excludeValue.filter((item): item is string => typeof item === "string" && allowed.has(item)))],
    };
  } catch {
    return { include: [], excludeFamilies: [...DEFAULT_EXCLUDED_FAMILIES] };
  }
}

export async function GET(request: Request) {
  const expected = ingestSecret();
  const token = /^Bearer ([^\s]{1,512})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (expected === null) return json({ ok: false, code: "INGEST_NOT_CONFIGURED" }, 503);
  if (!token || !(await equalSecret(token, expected))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);

  try {
    const database = getDb();
    const searchParams = new URL(request.url).searchParams;
    const requestedSourceValue = searchParams.get("source");
    if (requestedSourceValue !== null && requestedSourceValue !== "all" && !isActiveSource(requestedSourceValue)) {
      return json({ ok: false, code: "INVALID_SOURCE" }, 400);
    }
    const requestedSource = requestedSourceValue !== null && requestedSourceValue !== "all"
      ? requestedSourceValue
      : null;
    const includeEanScans = searchParams.get("includeEan") === "1";
    const includeTasks = searchParams.get("includeTasks") !== "0";
    const partnerAuthorization = authorizedPartnerSources();
    const authorizedSourceIds = ACTIVE_SOURCE_IDS.filter((source) => isPartnerSourceAuthorized(source, partnerAuthorization));
    const plannedSourceIds = requestedSource === null
      ? authorizedSourceIds
      : authorizedSourceIds.filter((source) => source === requestedSource);
    const staleClaim = new Date(Date.now() - 15 * 60_000).toISOString();
    await database.update(recheckRequests).set({ status: "pending", claimedAt: null, updatedAt: new Date().toISOString() })
      .where(and(eq(recheckRequests.status, "processing"), sql`${recheckRequests.claimedAt} < ${staleClaim}`));
    await database.update(inspectionRequests).set({ status: "pending", claimedAt: null, updatedAt: new Date().toISOString() })
      .where(and(eq(inspectionRequests.status, "processing"), sql`${inspectionRequests.claimedAt} < ${staleClaim}`));
    await database.update(eanScanRequests).set({ status: "queued", claimedAt: null, updatedAt: new Date().toISOString() })
      .where(and(eq(eanScanRequests.status, "processing"), sql`${eanScanRequests.claimedAt} < ${staleClaim}`));
    await database.update(sentinelFrontier).set({ status: "queued", updatedAt: new Date().toISOString() })
      .where(and(eq(sentinelFrontier.status, "processing"), sql`${sentinelFrontier.updatedAt} < ${staleClaim}`));
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const planNow = new Date().toISOString();
    const [rows, segments, pendingRechecks, pendingInspections, pendingEanScans, dueFrontier, duePurchaseChecks, runMetrics, alertMetrics] = await Promise.all([
      database
        .select()
        .from(sourceConfigurations)
        .where(and(eq(sourceConfigurations.enabled, true), inArray(sourceConfigurations.source, plannedSourceIds)))
        .orderBy(asc(sourceConfigurations.lastRunAt), asc(sourceConfigurations.source)),
      database
        .select()
        .from(discoverySegments)
        .where(eq(discoverySegments.enabled, true))
        .orderBy(desc(discoverySegments.priority), asc(discoverySegments.lastRunAt)),
      includeTasks ? database.select().from(recheckRequests)
        .where(and(eq(recheckRequests.status, "pending"), inArray(recheckRequests.source, plannedSourceIds)))
        .orderBy(asc(recheckRequests.requestedAt)).limit(25) : Promise.resolve([]),
      includeTasks ? database.select().from(inspectionRequests)
        .where(and(eq(inspectionRequests.status, "pending"), inArray(inspectionRequests.source, plannedSourceIds)))
        .orderBy(asc(inspectionRequests.requestedAt)).limit(100) : Promise.resolve([]),
      includeEanScans ? database.select().from(eanScanRequests)
        .where(and(
          inArray(eanScanRequests.status, ["queued", "monitoring", "matched", "failed"]),
          sql`${eanScanRequests.nextCheckAt} <= ${planNow}`,
        ))
        .orderBy(asc(eanScanRequests.nextCheckAt), desc(eanScanRequests.requestedAt)).limit(3) : Promise.resolve([]),
      includeTasks ? database.select().from(sentinelFrontier)
        .where(and(
          inArray(sentinelFrontier.status, ["queued", "active"]),
          inArray(sentinelFrontier.source, plannedSourceIds),
          sql`${sentinelFrontier.nextScanAt} <= ${new Date().toISOString()}`,
        ))
        .orderBy(desc(sentinelFrontier.priority), asc(sentinelFrontier.nextScanAt)).limit(50) : Promise.resolve([]),
      includeTasks ? database.select().from(purchases)
        .where(and(
          inArray(purchases.status, ["protected", "action_available"]),
          inArray(purchases.source, plannedSourceIds),
          sql`${purchases.nextCheckAt} <= ${planNow}`,
          sql`${purchases.protectionEndsAt} > ${planNow}`,
        ))
        .orderBy(asc(purchases.nextCheckAt)).limit(25) : Promise.resolve([]),
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
      const cadenceMinutes = effectiveCadence(row.source, row.cadenceMinutes, row.volatilityScore);
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
    const discoveryItems = (requestedSource === null || requestedSource === "amazon" ? segments : []).flatMap((segment) => {
      const due = segment.lastRunAt === null || now - Date.parse(segment.lastRunAt) >= segment.cadenceMinutes * 60_000;
      if (!due) return [];
      const runsPerDay = Math.max(1, Math.ceil(1_440 / segment.cadenceMinutes));
      const perRunLimit = Math.max(1, Math.min(100, Math.floor(segment.dailyTokenBudget / runsPerDay)));
      const page = Math.floor(now / (segment.cadenceMinutes * 60_000)) % 10;
      const categoryConfig = categoryConfiguration(segment.categoryIdsJson);
      return [{
        id: segment.id,
        source: "amazon" as const,
        market: segment.market,
        label: segment.label,
        categoryIds: categoryConfig.include,
        excludedFamilies: categoryConfig.excludeFamilies,
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
    const inspectionLimit = requestedSource === "amazon" ? 5 : 10;
    const uniqueInspections = [...new Map(pendingInspections.map((row) => [
      `${row.source}:${row.market}:${row.url}`,
      row,
    ])).values()].slice(0, inspectionLimit);
    const inspectionItems = uniqueInspections.map((row) => ({
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
    const eanGtins = pendingEanScans.map((row) => row.gtin);
    const knownEanProducts = eanGtins.length === 0 ? [] : await database.select({
      gtin: merchantProducts.gtin,
      source: merchantProducts.source,
      market: merchantProducts.market,
      url: merchantProducts.url,
    }).from(merchantProducts).where(and(
      inArray(merchantProducts.gtin, eanGtins),
      inArray(merchantProducts.source, authorizedSourceIds),
    )).orderBy(desc(merchantProducts.lastSeenAt)).limit(100);
    const eanItems = pendingEanScans.map((row) => ({
      id: row.id,
      gtin: row.gtin,
      markets: ["FR"],
      knownProducts: knownEanProducts.filter((product) => product.gtin === row.gtin).slice(0, 20).map((product) => ({
        source: product.source,
        market: product.market,
        url: product.url,
      })),
    }));
    if (eanItems.length > 0) {
      const claimedAt = new Date(now).toISOString();
      await database.update(eanScanRequests).set({ status: "processing", claimedAt, updatedAt: claimedAt })
        .where(and(
          inArray(eanScanRequests.id, eanItems.map((item) => item.id)),
          inArray(eanScanRequests.status, ["queued", "monitoring", "matched", "failed"]),
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
    const protectionItems = duePurchaseChecks.map((row) => ({
      id: row.id,
      source: row.source,
      market: row.market,
      url: row.url,
      shadowCart: true,
    }));
    if (protectionItems.length > 0) {
      const claimedAt = new Date(now).toISOString();
      await database.update(purchases).set({
        nextCheckAt: new Date(now + 6 * 60 * 60_000).toISOString(),
        updatedAt: claimedAt,
      }).where(inArray(purchases.id, protectionItems.map((item) => item.id)));
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
      eanScanCount: eanItems.length,
      eanScans: eanItems,
      frontierCount: frontierItems.length,
      frontier: frontierItems,
      protectionCount: protectionItems.length,
      protectionChecks: protectionItems,
    });
  } catch {
    return json({ ok: false, code: "SOURCE_PLAN_UNAVAILABLE" }, 503);
  }
}

export async function POST(request: Request) {
  const expected = ingestSecret();
  const token = /^Bearer ([^\s]{1,512})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (expected === null) return json({ ok: false, code: "INGEST_NOT_CONFIGURED" }, 503);
  if (!token || !(await equalSecret(token, expected))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);

  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ ok: false, code: "INVALID_BODY" }, 400); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json({ ok: false, code: "INVALID_BODY" }, 400);
  const body = raw as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  const kind = body.kind === "inspection" || body.kind === "recheck" ? body.kind : null;
  const status = body.status === "completed" || body.status === "failed" ? body.status : null;
  const errorCode = body.errorCode === null || body.errorCode === undefined
    ? null
    : typeof body.errorCode === "string" && /^[A-Z0-9_:-]{3,80}$/u.test(body.errorCode)
      ? body.errorCode
      : undefined;
  if (!/^[A-Za-z0-9._:-]{3,200}$/u.test(id) || kind === null || status === null || errorCode === undefined) {
    return json({ ok: false, code: "INVALID_RESULT" }, 400);
  }

  try {
    const database = getDb();
    const now = new Date().toISOString();
    const resultJson = JSON.stringify({ status, errorCode, reportedAt: now });
    if (kind === "inspection") {
      const [target] = await database.select({
        source: inspectionRequests.source,
        market: inspectionRequests.market,
        url: inspectionRequests.url,
      }).from(inspectionRequests).where(eq(inspectionRequests.id, id)).limit(1);
      if (!target) return json({ ok: false, code: "TASK_NOT_FOUND" }, 404);
      await database.update(inspectionRequests).set({
        status,
        resultJson,
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(inspectionRequests.source, target.source),
        eq(inspectionRequests.market, target.market),
        eq(inspectionRequests.url, target.url),
        inArray(inspectionRequests.status, ["pending", "processing"]),
      ));
    } else {
      await database.update(recheckRequests).set({
        status,
        resultJson,
        completedAt: now,
        updatedAt: now,
      }).where(and(
        eq(recheckRequests.id, id),
        inArray(recheckRequests.status, ["pending", "processing"]),
      ));
    }
    return json({ ok: true, id, kind, status });
  } catch {
    return json({ ok: false, code: "RESULT_UPDATE_FAILED" }, 503);
  }
}
