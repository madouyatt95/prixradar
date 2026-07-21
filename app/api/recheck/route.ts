import { and, desc, eq, gt, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { alerts, recheckRequests } from "@/db/schema";
import { deviceDatabaseError, deviceError, deviceJson, readJsonObject, resolveDevice } from "../push/device";

export const dynamic = "force-dynamic";

function result(value: string) {
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const alertId = new URL(request.url).searchParams.get("alertId")?.trim() ?? "";
  try {
    const rows = await getDb().select().from(recheckRequests).where(and(
      eq(recheckRequests.ownerId, identity.device.ownerId),
      ...(alertId ? [eq(recheckRequests.alertId, alertId)] : []),
    )).orderBy(desc(recheckRequests.requestedAt)).limit(alertId ? 1 : 30);
    return deviceJson(identity.device, { ok: true, items: rows.map((row) => ({ ...row, result: result(row.resultJson) })) });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  const alertId = typeof body?.alertId === "string" ? body.alertId.trim() : "";
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(alertId)) {
    return deviceError(identity.device, 400, "invalid_alert", "Alerte invalide.");
  }
  try {
    const [alert] = await getDb().select({
      id: alerts.id, source: alerts.source, market: alerts.market, url: alerts.url, sourceMode: alerts.sourceMode,
    }).from(alerts).where(eq(alerts.id, alertId)).limit(1);
    if (!alert || alert.sourceMode !== "live") {
      return deviceError(identity.device, 404, "alert_not_recheckable", "Seule une alerte active issue d’une collecte réelle peut être revérifiée.");
    }
    const recentAfter = new Date(Date.now() - 2 * 60_000).toISOString();
    const [existing] = await getDb().select().from(recheckRequests).where(and(
      eq(recheckRequests.ownerId, identity.device.ownerId),
      eq(recheckRequests.alertId, alertId),
      inArray(recheckRequests.status, ["pending", "processing"]),
      gt(recheckRequests.requestedAt, recentAfter),
    )).orderBy(desc(recheckRequests.requestedAt)).limit(1);
    if (existing) return deviceJson(identity.device, { ok: true, item: { ...existing, result: result(existing.resultJson) }, duplicate: true });
    const now = new Date().toISOString();
    const [item] = await getDb().insert(recheckRequests).values({
      id: `check:${crypto.randomUUID()}`,
      alertId,
      ownerId: identity.device.ownerId,
      source: alert.source,
      market: alert.market,
      url: alert.url,
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    }).returning();
    return deviceJson(identity.device, { ok: true, item: { ...item, result: {} } }, { status: 202 });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
