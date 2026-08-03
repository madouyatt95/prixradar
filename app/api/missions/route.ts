import { and, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";

import { getDb } from "@/db";
import { alerts, missionItems, radarRules } from "@/db/schema";
import { parseRadarIntent, radarIntentMatches, radarIntentSummary, type RadarIntent } from "@/lib/radar-intent";
import { deviceDatabaseError, deviceError, deviceJson, readJsonObject, resolveDevice } from "../push/device";

export const dynamic = "force-dynamic";

const MAX_MONEY_CENTS = 100_000_000;
const MISSION_ID = /^radar:[0-9a-f-]{36}$/u;

function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/\s+/gu, " ");
  return text.length <= maximum && !/\p{Cc}/u.test(text) ? text : "";
}

function money(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_MONEY_CENTS
    ? Number(value)
    : null;
}

function date(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  const now = Date.now();
  return Number.isFinite(timestamp) && timestamp > now && timestamp <= now + 366 * 86_400_000
    ? new Date(timestamp).toISOString()
    : undefined;
}

function intent(value: string) {
  return parseRadarIntent(value);
}

function meaningful(value: RadarIntent) {
  return value.keywords.length + value.brands.length + value.categories.length + value.markets.length
    + Number(value.maxPriceCents !== null) + Number(value.minDiscount !== null) > 0;
}

function parseIntent(value: string) {
  try { return JSON.parse(value) as RadarIntent; } catch { return null; }
}

function serializeMission(row: typeof radarRules.$inferSelect, items: Array<typeof missionItems.$inferSelect>, liveAlerts: Array<typeof alerts.$inferSelect>) {
  const missionItemsWithMatches = items.map((item) => {
    const parsed = parseIntent(item.intentJson);
    const candidates = parsed ? liveAlerts.filter((alert) => radarIntentMatches(parsed, {
      title: alert.title,
      brand: alert.brand,
      category: alert.category,
      market: alert.market,
      priceCents: alert.publicPriceCents ?? alert.priceCents,
      discountPercent: alert.discountPercent,
      condition: alert.condition,
      accessibleToAll: alert.priceAccessibleToAll,
      deliveryCountry: alert.deliveryCountry,
    })) : [];
    const match = candidates.sort((left, right) => (left.publicPriceCents ?? left.priceCents) - (right.publicPriceCents ?? right.priceCents))[0];
    return {
      ...item,
      intent: parsed,
      bestMatch: match ? {
        alertId: match.id,
        title: match.title,
        merchant: match.merchant,
        priceCents: match.publicPriceCents ?? match.priceCents,
        discountPercent: match.discountPercent,
        currency: match.currency,
      } : null,
    };
  });
  const purchased = missionItemsWithMatches.filter((item) => item.status === "purchased").length;
  const matched = missionItemsWithMatches.filter((item) => item.bestMatch !== null || item.status === "matched" || item.status === "purchased").length;
  return {
    ...row,
    intent: parseIntent(row.intentJson),
    items: missionItemsWithMatches,
    progress: {
      total: missionItemsWithMatches.length || 1,
      matched,
      purchased,
      percent: missionItemsWithMatches.length ? Math.round((purchased / missionItemsWithMatches.length) * 100) : row.status === "completed" ? 100 : 0,
    },
  };
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  try {
    const database = getDb();
    const rules = await database.select().from(radarRules)
      .where(eq(radarRules.ownerId, identity.device.ownerId))
      .orderBy(desc(radarRules.updatedAt)).limit(30);
    const [items, liveAlerts] = await Promise.all([
      rules.length ? database.select().from(missionItems).where(inArray(missionItems.missionId, rules.map((rule) => rule.id))) : Promise.resolve([]),
      database.select().from(alerts).where(and(
        eq(alerts.sourceMode, "live"), eq(alerts.status, "active"),
        isNotNull(alerts.verifiedAt), isNotNull(alerts.shippingCents),
        gt(alerts.expiresAt, new Date().toISOString()),
      )).orderBy(desc(alerts.score)).limit(100),
    ]);
    const itemsByMission = new Map<string, Array<typeof missionItems.$inferSelect>>();
    for (const item of items) itemsByMission.set(item.missionId, [...(itemsByMission.get(item.missionId) ?? []), item]);
    return deviceJson(identity.device, { ok: true, items: rules.map((rule) => serializeMission(rule, itemsByMission.get(rule.id) ?? [], liveAlerts)) });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request, 32 * 1024);
  if (!body) return deviceError(identity.device, 400, "invalid_mission", "Mission invalide.");
  const kind = body.kind === "project" ? "project" as const : "single" as const;
  const query = cleanText(body.query, 300);
  const requestedName = cleanText(body.name, 120);
  const budgetCents = body.budgetCents === null || body.budgetCents === undefined ? null : money(body.budgetCents);
  const deadlineAt = date(body.deadlineAt);
  if (deadlineAt === undefined || (body.budgetCents !== null && body.budgetCents !== undefined && budgetCents === null)) {
    return deviceError(identity.device, 400, "invalid_mission_limits", "Budget ou date limite invalide.");
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (kind === "project" && (rawItems.length < 2 || rawItems.length > 20)) {
    return deviceError(identity.device, 400, "invalid_project_items", "Un panier-projet contient 2 à 20 achats.");
  }
  const parsedItems = rawItems.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const value = raw as Record<string, unknown>;
    const itemQuery = cleanText(value.query ?? value.label, 300);
    const itemIntent = intent(itemQuery);
    const targetPriceCents = value.targetPriceCents === null || value.targetPriceCents === undefined ? null : money(value.targetPriceCents);
    const quantity = Number.isSafeInteger(value.quantity) ? Number(value.quantity) : 1;
    if (itemQuery.length < 2 || !meaningful(itemIntent) || targetPriceCents === null && value.targetPriceCents !== null && value.targetPriceCents !== undefined || quantity < 1 || quantity > 99) return [];
    return [{
      id: `mission-item:${crypto.randomUUID()}`,
      label: cleanText(value.label, 120) || radarIntentSummary(itemIntent).slice(0, 120) || `Achat ${index + 1}`,
      query: itemQuery,
      intentJson: JSON.stringify(itemIntent),
      quantity,
      required: value.required !== false,
      targetPriceCents,
    }];
  });
  if (kind === "project" && parsedItems.length !== rawItems.length) {
    return deviceError(identity.device, 400, "invalid_project_item", "Chaque achat doit décrire précisément un produit.");
  }
  const baseQuery = kind === "single" ? query : (requestedName || parsedItems.map((item) => item.label).join(" + ")).slice(0, 300);
  const baseIntent = intent(baseQuery);
  if (baseQuery.length < 3 || kind === "single" && !meaningful(baseIntent)) {
    return deviceError(identity.device, 400, "mission_too_broad", "Ajoutez un produit, une marque, un budget ou une remise.");
  }
  if (kind === "single") {
    parsedItems.push({
      id: `mission-item:${crypto.randomUUID()}`,
      label: requestedName || radarIntentSummary(baseIntent).slice(0, 120),
      query: baseQuery,
      intentJson: JSON.stringify(baseIntent),
      quantity: 1,
      required: true,
      targetPriceCents: baseIntent.maxPriceCents,
    });
  }
  const id = `radar:${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const name = requestedName || (kind === "project" ? baseQuery : radarIntentSummary(baseIntent)).slice(0, 120);
  try {
    const database = getDb();
    const missionInsert = database.insert(radarRules).values({
      id,
      ownerId: identity.device.ownerId,
      name,
      query: baseQuery,
      intentJson: JSON.stringify(baseIntent),
      kind,
      status: "active",
      budgetCents,
      deadlineAt,
      allowAlternatives: body.allowAlternatives !== false,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    if (parsedItems.length) {
      await database.batch([
        missionInsert,
        database.insert(missionItems).values(parsedItems.map((item) => ({ ...item, missionId: id, ownerId: identity.device.ownerId, createdAt: now, updatedAt: now }))),
      ]);
    } else await missionInsert;
    const [created] = await database.select().from(radarRules).where(eq(radarRules.id, id));
    const createdItems = parsedItems.length ? await database.select().from(missionItems).where(eq(missionItems.missionId, id)) : [];
    return deviceJson(identity.device, { ok: true, item: serializeMission(created, createdItems, []) }, { status: 201 });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function PATCH(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  const id = cleanText(body?.id, 80);
  const status = body?.status;
  if (!MISSION_ID.test(id) || !["active", "paused", "completed"].includes(String(status))) {
    return deviceError(identity.device, 400, "invalid_mission_update", "Mise à jour de mission invalide.");
  }
  const now = new Date().toISOString();
  try {
    const [item] = await getDb().update(radarRules).set({
      status: String(status),
      enabled: status === "active",
      completedAt: status === "completed" ? now : null,
      updatedAt: now,
    }).where(and(eq(radarRules.id, id), eq(radarRules.ownerId, identity.device.ownerId))).returning();
    if (!item) return deviceError(identity.device, 404, "mission_not_found", "Mission introuvable.");
    return deviceJson(identity.device, { ok: true, item });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function DELETE(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!MISSION_ID.test(id)) return deviceError(identity.device, 400, "invalid_mission", "Identifiant de mission invalide.");
  try {
    await getDb().delete(radarRules).where(and(eq(radarRules.id, id), eq(radarRules.ownerId, identity.device.ownerId)));
    return deviceJson(identity.device, { ok: true, id });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
