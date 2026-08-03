import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { alertIntelligence, alerts, missionItems, purchaseEvents, purchases, radarRules } from "@/db/schema";
import { assessPurchasability } from "@/lib/purchasability";
import { deviceDatabaseError, deviceError, deviceJson, readJsonObject, resolveDevice } from "../push/device";

export const dynamic = "force-dynamic";

const MAX_MONEY_CENTS = 100_000_000;
const PURCHASE_ID = /^purchase:[0-9a-f-]{36}$/u;

function positiveMoney(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_MONEY_CENTS ? Number(value) : null;
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  try {
    const database = getDb();
    const now = new Date().toISOString();
    await database.update(purchases).set({ status: "closed", updatedAt: now })
      .where(and(
        eq(purchases.ownerId, identity.device.ownerId),
        inArray(purchases.status, ["protected", "action_available"]),
        sql`${purchases.protectionEndsAt} <= ${now}`,
      ));
    const items = await database.select().from(purchases)
      .where(eq(purchases.ownerId, identity.device.ownerId))
      .orderBy(desc(purchases.purchasedAt)).limit(100);
    const events = items.length ? await database.select().from(purchaseEvents)
      .where(inArray(purchaseEvents.purchaseId, items.map((item) => item.id)))
      .orderBy(desc(purchaseEvents.occurredAt)).limit(300) : [];
    const eventsByPurchase = new Map<string, Array<typeof purchaseEvents.$inferSelect>>();
    for (const event of events) eventsByPurchase.set(event.purchaseId, [...(eventsByPurchase.get(event.purchaseId) ?? []), event]);
    const activeItems = items.filter((item) => item.status !== "returned");
    const summary = {
      purchaseCount: activeItems.length,
      realizedSavingsCents: activeItems.reduce((sum, item) => sum + item.realizedSavingsCents, 0),
      potentialRecoveryCents: activeItems.reduce((sum, item) => sum + item.potentialRecoveryCents, 0),
      protectedCount: activeItems.filter((item) => item.status === "protected" || item.status === "action_available").length,
      actionCount: activeItems.filter((item) => item.status === "action_available").length,
    };
    return deviceJson(identity.device, { ok: true, summary, items: items.map((item) => ({ ...item, events: eventsByPurchase.get(item.id) ?? [] })) });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  const alertId = typeof body?.alertId === "string" ? body.alertId.trim() : "";
  const paidTotalCents = positiveMoney(body?.paidTotalCents);
  const protectionDays = Number.isSafeInteger(body?.protectionDays) ? Number(body?.protectionDays) : 14;
  const missionId = typeof body?.missionId === "string" ? body.missionId.trim() : null;
  const missionItemId = typeof body?.missionItemId === "string" ? body.missionItemId.trim() : null;
  if (!alertId || paidTotalCents === null || protectionDays < 1 || protectionDays > 60) {
    return deviceError(identity.device, 400, "invalid_purchase", "Confirmez le prix réellement payé et une protection de 1 à 60 jours.");
  }
  try {
    const database = getDb();
    const result = await database.select({ alert: alerts, intelligence: alertIntelligence })
      .from(alerts)
      .leftJoin(alertIntelligence, eq(alertIntelligence.alertId, alerts.id))
      .where(eq(alerts.id, alertId)).limit(1);
    const row = result[0];
    if (!row) return deviceError(identity.device, 404, "alert_not_found", "Alerte introuvable.");
    const totalCents = row.intelligence?.finalTotalCents ?? (row.alert.shippingCents === null ? null : row.alert.priceCents + row.alert.shippingCents);
    const purchasability = assessPurchasability({
      sourceMode: row.alert.sourceMode,
      status: row.alert.status,
      verifiedAt: row.alert.verifiedAt,
      expiresAt: row.alert.expiresAt,
      totalCents,
      priceAccessibleToAll: row.alert.priceAccessibleToAll,
      cartStatus: row.intelligence?.shadowCartStatus,
      variantConfidence: row.intelligence?.variantConfidence,
      sellerScore: row.intelligence?.sellerScore,
    });
    if (purchasability.status === "blocked" || row.alert.sourceMode !== "live") {
      return deviceError(identity.device, 409, "purchase_requires_live_alert", "Seule une alerte LIVE encore achetable peut alimenter vos économies.");
    }
    if (totalCents === null || paidTotalCents < Math.round(totalCents * 0.5) || paidTotalCents > Math.round(totalCents * 1.5)) {
      return deviceError(identity.device, 400, "paid_total_out_of_range", "Le total payé semble trop éloigné du total vérifié. Revérifiez le montant.");
    }
    let ownedMissionItem: typeof missionItems.$inferSelect | null = null;
    if (missionItemId) {
      const [candidate] = await database.select().from(missionItems).where(and(
        eq(missionItems.id, missionItemId),
        eq(missionItems.ownerId, identity.device.ownerId),
      )).limit(1);
      if (!candidate || missionId && candidate.missionId !== missionId) {
        return deviceError(identity.device, 400, "invalid_mission_item", "Cet achat ne correspond pas à votre mission.");
      }
      ownedMissionItem = candidate;
    } else if (missionId) {
      const [mission] = await database.select({ id: radarRules.id }).from(radarRules).where(and(
        eq(radarRules.id, missionId), eq(radarRules.ownerId, identity.device.ownerId),
      )).limit(1);
      if (!mission) return deviceError(identity.device, 400, "invalid_mission", "Mission introuvable.");
    }
    const id = `purchase:${crypto.randomUUID()}`;
    const now = new Date();
    const nowIso = now.toISOString();
    const protectionEndsAt = new Date(now.getTime() + protectionDays * 86_400_000).toISOString();
    const referencePriceCents = Math.max(paidTotalCents, row.alert.usualPriceCents);
    const realizedSavingsCents = Math.max(0, referencePriceCents - paidTotalCents);
    const insertPurchase = database.insert(purchases).values({
      id,
      ownerId: identity.device.ownerId,
      alertId: row.alert.id,
      missionId: ownedMissionItem?.missionId ?? missionId,
      missionItemId: ownedMissionItem?.id ?? null,
      source: row.alert.source,
      market: row.alert.market,
      productId: row.alert.productId,
      title: row.alert.title,
      url: row.alert.url,
      currency: row.alert.currency,
      paidTotalCents,
      referencePriceCents,
      realizedSavingsCents,
      latestPriceCents: totalCents,
      bestPriceCents: totalCents,
      potentialRecoveryCents: Math.max(0, paidTotalCents - totalCents),
      status: "protected",
      purchasedAt: nowIso,
      protectionEndsAt,
      nextCheckAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    const insertEvent = database.insert(purchaseEvents).values({
      purchaseId: id,
      eventType: "purchased",
      priceCents: paidTotalCents,
      note: `Achat confirmé depuis l’alerte ${row.alert.id}`,
      occurredAt: nowIso,
    });
    if (ownedMissionItem) {
      await database.batch([
        insertPurchase,
        insertEvent,
        database.update(missionItems).set({ status: "purchased", selectedAlertId: row.alert.id, updatedAt: nowIso }).where(eq(missionItems.id, ownedMissionItem.id)),
      ]);
      const remaining = await database.select({ id: missionItems.id }).from(missionItems).where(and(
        eq(missionItems.missionId, ownedMissionItem.missionId),
        eq(missionItems.required, true),
        sql`${missionItems.status} != 'purchased'`,
      )).limit(1);
      if (remaining.length === 0) await database.update(radarRules).set({ status: "completed", enabled: false, completedAt: nowIso, updatedAt: nowIso }).where(eq(radarRules.id, ownedMissionItem.missionId));
    } else await database.batch([insertPurchase, insertEvent]);
    const [created] = await database.select().from(purchases).where(eq(purchases.id, id));
    return deviceJson(identity.device, { ok: true, item: created, purchasability }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) return deviceError(identity.device, 409, "purchase_already_recorded", "Cet achat est déjà protégé.");
    return deviceDatabaseError(identity.device, error);
  }
}

export async function PATCH(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!PURCHASE_ID.test(id) || !["action_opened", "kept", "returned", "closed"].includes(action)) {
    return deviceError(identity.device, 400, "invalid_purchase_update", "Action d’achat invalide.");
  }
  try {
    const database = getDb();
    const [purchase] = await database.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.ownerId, identity.device.ownerId))).limit(1);
    if (!purchase) return deviceError(identity.device, 404, "purchase_not_found", "Achat introuvable.");
    const now = new Date().toISOString();
    const status = action === "action_opened" ? purchase.status : action;
    await database.batch([
      database.update(purchases).set({ status, ...(action === "action_opened" ? {} : { protectionEndsAt: now }), updatedAt: now }).where(eq(purchases.id, id)),
      database.insert(purchaseEvents).values({ purchaseId: id, eventType: action, priceCents: purchase.latestPriceCents, occurredAt: now }),
    ]);
    return deviceJson(identity.device, { ok: true, id, status });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
