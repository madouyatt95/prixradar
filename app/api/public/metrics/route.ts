import { and, eq, gte } from "drizzle-orm";

import { getDb } from "@/db";
import { alertFeedback, alerts, notificationDeliveries, priceObservations } from "@/db/schema";
import { computeReliabilityMetrics } from "@/lib/public-intelligence";

export const dynamic = "force-dynamic";

const LIMITS = {
  alerts: 5_000,
  feedback: 10_000,
  observations: 20_000,
  deliveries: 10_000,
} as const;

function json(body: unknown, status = 200, cache = false) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": cache ? "public, max-age=60, stale-while-revalidate=300" : "no-store",
    },
  });
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("D1 binding") || message.includes("env.DB")) {
    return json({ ok: false, code: "DATABASE_UNAVAILABLE", message: "Les métriques publiques ne sont pas encore disponibles." }, 503);
  }
  if (message.includes("no such table")) {
    return json({ ok: false, code: "METRICS_NOT_READY", message: "Le stockage des métriques n’est pas initialisé." }, 503);
  }
  return json({ ok: false, code: "METRICS_FAILED", message: "Les métriques publiques ne peuvent pas être calculées." }, 500);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawDays = url.searchParams.get("days") ?? "7";
  if (rawDays !== "7" && rawDays !== "30") {
    return json({ ok: false, code: "INVALID_PERIOD", message: "days doit valoir 7 ou 30." }, 400);
  }
  const periodDays = Number(rawDays);
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.parse(generatedAt) - periodDays * 86_400_000).toISOString();

  try {
    const database = getDb();
    const [alertRows, feedbackRows, observationRows, deliveryRows] = await Promise.all([
      database.select({
        id: alerts.id,
        source: alerts.source,
        category: alerts.category,
        observedAt: alerts.observedAt,
        verifiedAt: alerts.verifiedAt,
        shippingCents: alerts.shippingCents,
        status: alerts.status,
      }).from(alerts).where(and(
        eq(alerts.sourceMode, "live"),
        gte(alerts.observedAt, since),
      )).limit(LIMITS.alerts + 1),
      database.selectDistinct({
        alertId: alertFeedback.alertId,
        verdict: alertFeedback.verdict,
      }).from(alertFeedback)
        .innerJoin(alerts, eq(alerts.id, alertFeedback.alertId))
        .innerJoin(notificationDeliveries, and(
          eq(notificationDeliveries.alertId, alertFeedback.alertId),
          eq(notificationDeliveries.ownerId, alertFeedback.ownerId),
          eq(notificationDeliveries.status, "sent"),
        )).where(and(
        eq(alerts.sourceMode, "live"),
        gte(alerts.observedAt, since),
      )).limit(LIMITS.feedback + 1),
      database.select({
        alertId: priceObservations.alertId,
        available: priceObservations.available,
        observedAt: priceObservations.observedAt,
      }).from(priceObservations).innerJoin(alerts, eq(alerts.id, priceObservations.alertId)).where(and(
        eq(alerts.sourceMode, "live"),
        gte(alerts.observedAt, since),
        gte(priceObservations.observedAt, since),
      )).limit(LIMITS.observations + 1),
      database.select({
        alertId: notificationDeliveries.alertId,
        sentAt: notificationDeliveries.sentAt,
      }).from(notificationDeliveries).innerJoin(alerts, eq(alerts.id, notificationDeliveries.alertId)).where(and(
        eq(alerts.sourceMode, "live"),
        eq(notificationDeliveries.status, "sent"),
        gte(alerts.observedAt, since),
      )).limit(LIMITS.deliveries + 1),
    ]);
    const truncated = {
      alerts: alertRows.length > LIMITS.alerts,
      feedback: feedbackRows.length > LIMITS.feedback,
      observations: observationRows.length > LIMITS.observations,
      deliveries: deliveryRows.length > LIMITS.deliveries,
    };
    const incomplete = Object.values(truncated).some(Boolean);
    const reliability = computeReliabilityMetrics({
      alerts: alertRows.slice(0, LIMITS.alerts),
      feedback: feedbackRows.slice(0, LIMITS.feedback),
      observations: observationRows.slice(0, LIMITS.observations),
      deliveries: deliveryRows.slice(0, LIMITS.deliveries),
    }, { incomplete });

    return json({
      ok: true,
      version: "2026-07-1",
      generatedAt,
      period: { days: periodDays, since, timezone: "UTC" },
      dataQuality: {
        status: incomplete ? "incomplete_data" : "complete_query",
        truncated,
        minimumSamples: { publicRate: 30, notificationLatency: 10, sourceOrCategory: 10 },
      },
      reliability,
      methodology: {
        population: "Alertes LIVE observées pendant la période; les données demo et fixture sont exclues.",
        feedback: "Seuls les retours d’un appareil ayant réellement reçu l’alerte sont mesurés; une alerte évaluée est positive ou négative à la majorité de ces retours.",
        availability: "Le taux à 5, 15 ou 30 minutes utilise uniquement les alertes réellement revérifiées dans les 15 minutes suivant l’échéance.",
        latency: "Médiane entre la première observation et le premier push envoyé, une seule mesure par alerte.",
        insufficientSample: "Sous le minimum publié, value reste null: aucun pourcentage fragile n’est affiché comme une certitude.",
      },
    }, 200, true);
  } catch (error) {
    return databaseError(error);
  }
}
