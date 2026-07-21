import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { alertIntelligence, alerts, priceObservations } from "@/db/schema";
import { aggregateIntegrityIndex, evaluatePromotionIntegrity } from "@/lib/public-intelligence";

export const dynamic = "force-dynamic";

const EVALUATION_LIMIT = 200;

function json(body: unknown, status = 200, cache = false) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": cache ? "public, max-age=60, stale-while-revalidate=300" : "no-store",
    },
  });
}

function boundedLimit(value: string | null) {
  if (value === null) return 20;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : null;
}

function merchantCount(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    const count = (parsed as Record<string, unknown>).merchantCount;
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : 0;
  } catch {
    return 0;
  }
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("D1 binding") || message.includes("env.DB")) {
    return json({ ok: false, code: "DATABASE_UNAVAILABLE", message: "L’indice de sincérité n’est pas encore disponible." }, 503);
  }
  if (message.includes("no such table")) {
    return json({ ok: false, code: "INTEGRITY_NOT_READY", message: "Le stockage de l’indice n’est pas initialisé." }, 503);
  }
  return json({ ok: false, code: "INTEGRITY_FAILED", message: "L’indice de sincérité ne peut pas être calculé." }, 500);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = boundedLimit(url.searchParams.get("limit"));
  if (limit === null) {
    return json({ ok: false, code: "INVALID_LIMIT", message: "limit doit être compris entre 1 et 50." }, 400);
  }
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.parse(generatedAt) - 30 * 86_400_000).toISOString();
  const historySince = new Date(Date.parse(generatedAt) - 60 * 86_400_000).toISOString();

  try {
    const database = getDb();
    const baseWhere = and(eq(alerts.sourceMode, "live"), gte(alerts.observedAt, since));
    const [candidateRows, countRows] = await Promise.all([
      database.select({
        id: alerts.id,
        source: alerts.source,
        merchant: alerts.merchant,
        market: alerts.market,
        title: alerts.title,
        currency: alerts.currency,
        observedAt: alerts.observedAt,
        currentPriceCents: alerts.priceCents,
        shippingCents: alerts.shippingCents,
        observedDiscountPercent: alerts.discountPercent,
        marketMedianCents: alertIntelligence.priceIndexCents,
        priceIndexJson: alertIntelligence.priceIndexJson,
      }).from(alerts).innerJoin(alertIntelligence, eq(alertIntelligence.alertId, alerts.id))
        .where(baseWhere)
        .orderBy(desc(alerts.observedAt), desc(alerts.id))
        .limit(EVALUATION_LIMIT),
      database.select({ count: sql<number>`count(*)` }).from(alerts).innerJoin(
        alertIntelligence,
        eq(alertIntelligence.alertId, alerts.id),
      ).where(baseWhere),
    ]);
    const ids = candidateRows.map((row) => row.id);
    const observationBatches = ids.length === 0 ? [] : await Promise.all(
      chunks(ids, 80).map((batch) => database.select({
        alertId: priceObservations.alertId,
        totalCents: priceObservations.totalCents,
        available: priceObservations.available,
        observedAt: priceObservations.observedAt,
      }).from(priceObservations).where(and(
        inArray(priceObservations.alertId, batch),
        gte(priceObservations.observedAt, historySince),
      ))),
    );
    const observationsByAlert = new Map<string, Array<{ totalCents: number | null; available: boolean; observedAt: string }>>();
    for (const point of observationBatches.flat()) {
      const points = observationsByAlert.get(point.alertId) ?? [];
      points.push(point);
      observationsByAlert.set(point.alertId, points);
    }
    const items = candidateRows.map((row) => {
      const integrity = evaluatePromotionIntegrity({
        currentTotalCents: row.shippingCents === null ? null : row.currentPriceCents + row.shippingCents,
        observedDiscountPercent: row.observedDiscountPercent,
        observedAt: row.observedAt,
        history: observationsByAlert.get(row.id) ?? [],
        marketMedianCents: row.marketMedianCents,
        marketMerchantCount: merchantCount(row.priceIndexJson),
      });
      return {
        alertId: row.id,
        source: row.source,
        merchant: row.merchant,
        market: row.market,
        title: row.title,
        currency: row.currency,
        observedAt: row.observedAt,
        ...integrity,
      };
    });
    const totalPopulation = Number(countRows[0]?.count ?? 0);
    const index = aggregateIntegrityIndex(items);
    return json({
      ok: true,
      version: "2026-07-1",
      generatedAt,
      period: { historyDays: 30, since, timezone: "UTC" },
      status: index.status,
      index,
      sample: {
        liveAlertsInPopulation: totalPopulation,
        evaluatedLatestAlerts: items.length,
        eligibleForIndex: items.filter((item) => item.status === "measured").length,
        sampling: totalPopulation > EVALUATION_LIMIT ? "latest_200" : "complete_population",
      },
      items: items.slice(0, limit),
      methodology: {
        purpose: "Mesurer la cohérence d’une baisse détectée avec le plus bas prix antérieur sur 30 jours et avec la médiane multi-enseignes.",
        history: "65 % du score. Une remise PrixRadar supérieure à la baisse vérifiable face au plus bas antérieur est pénalisée; cinq points antérieurs sont requis.",
        market: "35 % du score. Le total payable est comparé à la médiane d’au moins deux offres marchandes rapprochées.",
        scope: "L’indice porte sur les alertes LIVE détectées par PrixRadar. Ce n’est ni le taux de conformité d’une enseigne ni une conclusion juridique.",
        advertisedPriceCaveat: "observedDiscountPercent est la remise calculée par PrixRadar, pas nécessairement le pourcentage publicitaire affiché par le marchand.",
        missingEvidence: "Sans les deux composantes, score reste null et status vaut insufficient_evidence.",
      },
    }, 200, true);
  } catch (error) {
    return databaseError(error);
  }
}
