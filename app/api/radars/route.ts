import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { radarRules } from "@/db/schema";
import { parseRadarIntent, radarIntentSummary } from "@/lib/radar-intent";
import { deviceDatabaseError, deviceError, deviceJson, readJsonObject, resolveDevice } from "../push/device";

export const dynamic = "force-dynamic";

function serialize(row: typeof radarRules.$inferSelect) {
  let intent: unknown = {};
  try { intent = JSON.parse(row.intentJson); } catch { intent = {}; }
  return { ...row, intent };
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  try {
    const items = await getDb().select().from(radarRules)
      .where(eq(radarRules.ownerId, identity.device.ownerId))
      .orderBy(desc(radarRules.updatedAt)).limit(30);
    return deviceJson(identity.device, { ok: true, items: items.map(serialize) });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  const query = typeof body?.query === "string" ? body.query.trim().replace(/\s+/gu, " ") : "";
  if (query.length < 3 || query.length > 300 || /\p{Cc}/u.test(query)) {
    return deviceError(identity.device, 400, "invalid_radar", "Décrivez le produit recherché en 3 à 300 caractères.");
  }
  const intent = parseRadarIntent(query);
  const meaningful = intent.keywords.length + intent.brands.length + intent.categories.length + intent.markets.length
    + Number(intent.maxPriceCents !== null) + Number(intent.minDiscount !== null);
  if (meaningful === 0) {
    return deviceError(identity.device, 400, "radar_too_broad", "Ajoutez un produit, une marque, une catégorie, un budget ou une remise.");
  }
  const id = `radar:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    const count = await getDb().select({ count: sql<number>`count(*)` }).from(radarRules)
      .where(and(eq(radarRules.ownerId, identity.device.ownerId), eq(radarRules.enabled, true)));
    if (Number(count[0]?.count ?? 0) >= 20) {
      return deviceError(identity.device, 409, "radar_limit", "Désactivez un radar avant d’en ajouter un autre.");
    }
    const [item] = await getDb().insert(radarRules).values({
      id,
      ownerId: identity.device.ownerId,
      name: radarIntentSummary(intent).slice(0, 120),
      query,
      intentJson: JSON.stringify(intent),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }).returning();
    return deviceJson(identity.device, { ok: true, item: serialize(item) }, { status: 201 });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function DELETE(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!/^radar:[0-9a-f-]{36}$/u.test(id)) {
    return deviceError(identity.device, 400, "invalid_radar", "Identifiant de radar invalide.");
  }
  try {
    await getDb().delete(radarRules).where(and(eq(radarRules.id, id), eq(radarRules.ownerId, identity.device.ownerId)));
    return deviceJson(identity.device, { ok: true, id });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
