import { desc, eq, gte, sql } from "drizzle-orm";
import { runtimeEnv as env } from "@/lib/runtime-env";

import { getDb } from "@/db";
import { alertFeedback, alerts, collectionRuns, notificationDeliveries, sourceConfigurations } from "@/db/schema";
import { adminJson, authorizeAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  const database = getDb();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  try {
    const [runRows, alertRows, feedbackRows, deliveryRows, sources] = await Promise.all([
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
      },
      sources,
    });
  } catch {
    return adminJson({ ok: false, code: "ADMIN_OVERVIEW_FAILED", error: "Le pilotage n’est pas encore disponible." }, 503);
  }
}
