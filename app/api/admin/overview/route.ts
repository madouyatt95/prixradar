import { desc, eq, gte, sql } from "drizzle-orm";
import { runtimeEnv as env } from "@/lib/runtime-env";

import { getDb } from "@/db";
import { alertFeedback, alertIntelligence, alerts, collectionRuns, inspectionRequests, notificationDeliveries, sentinelFrontier, sourceConfigurations } from "@/db/schema";
import { adminJson, authorizeAdmin } from "@/lib/admin";
import { optimizeCoverageBudgets } from "@/lib/budget-optimizer";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  const database = getDb();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  try {
    const [runRows, alertRows, feedbackRows, deliveryRows, sources, sourceRunRows, sourceAlertRows, autonomyRows, frontierRows, inspectionRows] = await Promise.all([
      database.select({
        runs: sql<number>`count(*)`,
        productsSeen: sql<number>`coalesce(sum(${collectionRuns.productsSeen}), 0)`,
        antiBotBlocks: sql<number>`coalesce(sum(case when ${collectionRuns.antiBotBlocked} = 1 then 1 else 0 end), 0)`,
        keepaRequests: sql<number>`coalesce(sum(${collectionRuns.keepaRequests}), 0)`,
        apifyCostMicros: sql<number>`coalesce(sum(${collectionRuns.apifyCostMicros}), 0)`,
      }).from(collectionRuns).where(gte(collectionRuns.attemptedAt, since)),
      database.select({
        accepted: sql<number>`count(*)`,
        exploitable: sql<number>`coalesce(sum(case when ${alerts.status} = 'active' then 1 else 0 end), 0)`,
        review: sql<number>`coalesce(sum(case when ${alerts.status} = 'review' then 1 else 0 end), 0)`,
        conditional: sql<number>`coalesce(sum(case when ${alerts.priceAccessibleToAll} = 0 then 1 else 0 end), 0)`,
      }).from(alerts).where(gte(alerts.updatedAt, since)),
      database.select({
        total: sql<number>`count(*)`,
        useful: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'useful' then 1 else 0 end), 0)`,
        falsePositive: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'false_positive' then 1 else 0 end), 0)`,
        expired: sql<number>`coalesce(sum(case when ${alertFeedback.verdict} = 'expired' then 1 else 0 end), 0)`,
        averageLifetimeMinutes: sql<number>`coalesce(avg(case when ${alertFeedback.verdict} = 'expired' then (julianday(${alertFeedback.updatedAt}) - julianday(${alerts.observedAt})) * 1440 end), 0)`,
      }).from(alertFeedback).innerJoin(alerts, eq(alerts.id, alertFeedback.alertId)).where(gte(alertFeedback.updatedAt, since)),
      database.select({
        sent: sql<number>`coalesce(sum(case when ${notificationDeliveries.status} = 'sent' then 1 else 0 end), 0)`,
        failed: sql<number>`coalesce(sum(case when ${notificationDeliveries.status} = 'failed' then 1 else 0 end), 0)`,
      }).from(notificationDeliveries).where(gte(notificationDeliveries.attemptedAt, since)),
      database.select().from(sourceConfigurations).orderBy(desc(sourceConfigurations.updatedAt)),
      database.select({
        source: collectionRuns.source,
        market: collectionRuns.market,
        productsSeen: sql<number>`coalesce(sum(${collectionRuns.productsSeen}), 0)`,
        costMicros: sql<number>`coalesce(sum(${collectionRuns.apifyCostMicros}), 0)`,
        antiBotBlocks: sql<number>`coalesce(sum(case when ${collectionRuns.antiBotBlocked} = 1 then 1 else 0 end), 0)`,
      }).from(collectionRuns).where(gte(collectionRuns.attemptedAt, since)).groupBy(collectionRuns.source, collectionRuns.market),
      database.select({
        source: alerts.source,
        market: alerts.market,
        exploitableAlerts: sql<number>`coalesce(sum(case when ${alerts.status} = 'active' then 1 else 0 end), 0)`,
      }).from(alerts).where(gte(alerts.updatedAt, since)).groupBy(alerts.source, alerts.market),
      database.select({
        analyzed: sql<number>`count(*)`,
        cartsConfirmed: sql<number>`coalesce(sum(case when ${alertIntelligence.shadowCartStatus} = 'confirmed' then 1 else 0 end), 0)`,
        trueAnomalies: sql<number>`coalesce(sum(case when ${alertIntelligence.anomalyKind} = 'true_anomaly' then 1 else 0 end), 0)`,
        riskySellers: sql<number>`coalesce(sum(case when ${alertIntelligence.sellerScore} < 55 then 1 else 0 end), 0)`,
        averageVariantConfidence: sql<number>`coalesce(avg(${alertIntelligence.variantConfidence}), 0)`,
        averageUrgency: sql<number>`coalesce(avg(${alertIntelligence.urgencyScore}), 0)`,
      }).from(alertIntelligence).where(gte(alertIntelligence.updatedAt, since)),
      database.select({
        total: sql<number>`count(*)`,
        active: sql<number>`coalesce(sum(case when ${sentinelFrontier.status} in ('queued', 'processing', 'active') then 1 else 0 end), 0)`,
        blocked: sql<number>`coalesce(sum(case when ${sentinelFrontier.status} = 'blocked' then 1 else 0 end), 0)`,
        duplicates: sql<number>`coalesce(sum(${sentinelFrontier.duplicateCount}), 0)`,
      }).from(sentinelFrontier),
      database.select({
        requested: sql<number>`count(*)`,
        completed: sql<number>`coalesce(sum(case when ${inspectionRequests.status} = 'completed' then 1 else 0 end), 0)`,
      }).from(inspectionRequests).where(gte(inspectionRequests.requestedAt, since)),
    ]);
    const runs = runRows[0] ?? { runs: 0, productsSeen: 0, antiBotBlocks: 0, keepaRequests: 0, apifyCostMicros: 0 };
    const alertMetrics = alertRows[0] ?? { accepted: 0, exploitable: 0, review: 0, conditional: 0 };
    const feedback = feedbackRows[0] ?? { total: 0, useful: 0, falsePositive: 0, expired: 0 };
    const costEuros = Number(runs.apifyCostMicros) / 1_000_000;
    const monthlyKeepaCentsRaw = (env as unknown as { KEEPA_MONTHLY_COST_CENTS?: unknown }).KEEPA_MONTHLY_COST_CENTS ?? process.env.KEEPA_MONTHLY_COST_CENTS;
    const monthlyKeepaCents = typeof monthlyKeepaCentsRaw === "string" && /^\d{1,8}$/.test(monthlyKeepaCentsRaw) ? Number(monthlyKeepaCentsRaw) : 0;
    const keepaEstimatedCostEuros = (monthlyKeepaCents / 100) * (7 / 30);
    const totalCostEuros = costEuros + keepaEstimatedCostEuros;
    const exploitable = Number(alertMetrics.exploitable);
    const runByKey = new Map(sourceRunRows.map((row) => [`${row.source}:${row.market}`, row]));
    const alertByKey = new Map(sourceAlertRows.map((row) => [`${row.source}:${row.market}`, row]));
    const budgetRecommendations = optimizeCoverageBudgets(sources.map((source) => {
      const key = `${source.source}:${source.market}`;
      const run = runByKey.get(key);
      return {
        id: source.id,
        currentBudget: source.dailyProductBudget,
        productsSeen: Number(run?.productsSeen ?? 0),
        exploitableAlerts: Number(alertByKey.get(key)?.exploitableAlerts ?? 0),
        costMicros: Number(run?.costMicros ?? 0),
        antiBotBlocks: Number(run?.antiBotBlocks ?? 0),
      };
    }));
    return adminJson({
      ok: true,
      periodDays: 7,
      generatedAt: new Date().toISOString(),
      metrics: {
        runs: Number(runs.runs),
        productsSeen: Number(runs.productsSeen),
        antiBotBlocks: Number(runs.antiBotBlocks),
        keepaRequests: Number(runs.keepaRequests),
        apifyCostEuros: costEuros,
        keepaEstimatedCostEuros,
        totalCostEuros,
        costPerExploitableAlertEuros: exploitable > 0 && totalCostEuros > 0 ? totalCostEuros / exploitable : null,
        alertsAccepted: Number(alertMetrics.accepted),
        exploitableAlerts: exploitable,
        alertsInReview: Number(alertMetrics.review),
        conditionalPrices: Number(alertMetrics.conditional),
        pushSent: Number(deliveryRows[0]?.sent ?? 0),
        pushFailed: Number(deliveryRows[0]?.failed ?? 0),
        feedback: {
          total: Number(feedback.total),
          useful: Number(feedback.useful),
          falsePositive: Number(feedback.falsePositive),
          expired: Number(feedback.expired),
          averageLifetimeMinutes: Math.max(0, Math.round(Number(feedback.averageLifetimeMinutes ?? 0))),
        },
        autonomy: {
          analyzed: Number(autonomyRows[0]?.analyzed ?? 0),
          cartsConfirmed: Number(autonomyRows[0]?.cartsConfirmed ?? 0),
          trueAnomalies: Number(autonomyRows[0]?.trueAnomalies ?? 0),
          riskySellers: Number(autonomyRows[0]?.riskySellers ?? 0),
          averageVariantConfidence: Math.round(Number(autonomyRows[0]?.averageVariantConfidence ?? 0)),
          averageUrgency: Math.round(Number(autonomyRows[0]?.averageUrgency ?? 0)),
          frontierTotal: Number(frontierRows[0]?.total ?? 0),
          frontierActive: Number(frontierRows[0]?.active ?? 0),
          frontierBlocked: Number(frontierRows[0]?.blocked ?? 0),
          duplicatesAvoided: Number(frontierRows[0]?.duplicates ?? 0),
          inspectionsRequested: Number(inspectionRows[0]?.requested ?? 0),
          inspectionsCompleted: Number(inspectionRows[0]?.completed ?? 0),
        },
      },
      sources,
      budgetRecommendations,
    });
  } catch {
    return adminJson({ ok: false, code: "ADMIN_OVERVIEW_FAILED", error: "Le pilotage n’est pas encore disponible." }, 503);
  }
}
