import { and, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { alertIntelligence, alerts, priceObservations } from "@/db/schema";
import { evaluatePromotionIntegrity } from "@/lib/public-intelligence";
import { buildCertifiedPassport } from "@/lib/public-proof";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, cache = false) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": cache ? "public, max-age=30, stale-while-revalidate=120" : "no-store",
    },
  });
}

function marketMerchantCount(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    const count = (parsed as Record<string, unknown>).merchantCount;
    return typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : 0;
  } catch {
    return 0;
  }
}

function databaseError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("D1 binding") || message.includes("env.DB")) {
    return json({ ok: false, code: "DATABASE_UNAVAILABLE", message: "Le passeport public n’est pas encore disponible." }, 503);
  }
  if (message.includes("no such table")) {
    return json({ ok: false, code: "CERTIFICATE_NOT_READY", message: "Le stockage des preuves n’est pas initialisé." }, 503);
  }
  return json({ ok: false, code: "CERTIFICATE_FAILED", message: "Le passeport public ne peut pas être chargé." }, 500);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(id)) {
    return json({ ok: false, code: "INVALID_ALERT_ID", message: "L’identifiant du passeport est invalide." }, 400);
  }

  try {
    const database = getDb();
    const rows = await database.select().from(alerts).leftJoin(
      alertIntelligence,
      eq(alertIntelligence.alertId, alerts.id),
    ).where(and(eq(alerts.id, id), eq(alerts.sourceMode, "live"))).limit(1);
    const row = rows[0];
    if (!row) {
      return json({ ok: false, code: "CERTIFICATE_NOT_FOUND", message: "Ce passeport LIVE n’existe pas." }, 404);
    }
    const observations = await database.select({
      priceCents: priceObservations.priceCents,
      shippingCents: priceObservations.shippingCents,
      totalCents: priceObservations.totalCents,
      available: priceObservations.available,
      observedAt: priceObservations.observedAt,
    }).from(priceObservations).where(eq(priceObservations.alertId, id))
      .orderBy(desc(priceObservations.observedAt))
      .limit(180);
    const currentTotalCents = row.alert_intelligence?.finalTotalCents
      ?? (row.alerts.shippingCents === null ? null : row.alerts.priceCents + row.alerts.shippingCents);
    const integrity = evaluatePromotionIntegrity({
      currentTotalCents,
      observedDiscountPercent: row.alerts.discountPercent,
      observedAt: row.alerts.observedAt,
      history: observations,
      marketMedianCents: row.alert_intelligence?.priceIndexCents ?? null,
      marketMerchantCount: row.alert_intelligence ? marketMerchantCount(row.alert_intelligence.priceIndexJson) : 0,
    });
    const generatedAt = new Date().toISOString();
    const passport = buildCertifiedPassport({
      alert: row.alerts,
      intelligence: row.alert_intelligence,
      observations,
      integrity,
      generatedAt,
    });
    return json({ ok: true, passport }, 200, true);
  } catch (error) {
    return databaseError(error);
  }
}
