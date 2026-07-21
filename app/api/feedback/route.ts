import { desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { alertFeedback, alerts } from "@/db/schema";
import { deviceDatabaseError, deviceError, deviceJson, readJsonObject, resolveDevice } from "../push/device";

export const dynamic = "force-dynamic";

const VERDICTS = new Set(["useful", "false_positive", "expired"]);

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
    const exists = await getDb().select({ id: alerts.id }).from(alerts).where(eq(alerts.id, alertId)).limit(1);
    if (!exists[0]) return deviceError(identity.device, 404, "alert_not_found", "Alerte introuvable.");
    await getDb().insert(alertFeedback).values({ alertId, ownerId: identity.device.ownerId, verdict })
      .onConflictDoUpdate({
        target: [alertFeedback.ownerId, alertFeedback.alertId],
        set: { verdict, updatedAt: sql`CURRENT_TIMESTAMP` },
      });
    return deviceJson(identity.device, { ok: true, alertId, verdict });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
