import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { alertFeedback, alerts, notificationDeliveries } from "@/db/schema";
import { deviceDatabaseError, deviceError, deviceJson, readJsonObject, resolveDevice } from "../push/device";

export const dynamic = "force-dynamic";

const VERDICTS = new Set([
  "useful", "false_positive", "expired", "purchased", "cancelled",
  "wrong_variant", "coupon_failed", "price_confirmed",
]);

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  try {
    const items = await getDb().select({ alertId: alertFeedback.alertId, verdict: alertFeedback.verdict, updatedAt: alertFeedback.updatedAt })
      .from(alertFeedback).where(eq(alertFeedback.ownerId, identity.device.ownerId)).orderBy(desc(alertFeedback.updatedAt)).limit(200);
    return deviceJson(identity.device, { ok: true, items });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  const alertId = typeof body?.alertId === "string" ? body.alertId.trim() : "";
  const verdict = typeof body?.verdict === "string" ? body.verdict : "";
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(alertId) || !VERDICTS.has(verdict)) {
    return deviceError(identity.device, 400, "invalid_feedback", "Alerte ou verdict invalide.");
  }
  try {
    const database = getDb();
    const exists = await database.select({ id: alerts.id }).from(alerts).where(eq(alerts.id, alertId)).limit(1);
    if (!exists[0]) return deviceError(identity.device, 404, "alert_not_found", "Alerte introuvable.");
    const delivered = await database.select({ id: notificationDeliveries.id }).from(notificationDeliveries).where(and(
      eq(notificationDeliveries.alertId, alertId),
      eq(notificationDeliveries.ownerId, identity.device.ownerId),
      eq(notificationDeliveries.status, "sent"),
    )).limit(1);
    if (!delivered[0]) {
      return deviceError(identity.device, 403, "feedback_requires_delivery", "Ce retour sera disponible après réception de l’alerte sur cet appareil.");
    }
    await database.insert(alertFeedback).values({ alertId, ownerId: identity.device.ownerId, verdict })
      .onConflictDoUpdate({
        target: [alertFeedback.ownerId, alertFeedback.alertId],
        set: { verdict, updatedAt: sql`CURRENT_TIMESTAMP` },
      });
    return deviceJson(identity.device, { ok: true, alertId, verdict });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
