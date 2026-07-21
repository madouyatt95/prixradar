import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { discoverySegments } from "@/db/schema";
import { adminJson, authorizeAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const MARKETS = new Set(["FR", "DE", "IT", "ES", "GB"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown, field: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} est invalide.`);
  }
  return Number(value);
}

function categories(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error("categoryIds est invalide.");
  return [...new Set(value.map((item) => integer(item, "categoryIds", 1, 9_999_999_999)))];
}

async function idFor(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `ds_${[...new Uint8Array(digest)].slice(0, 12).map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

export async function GET(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  try {
    const items = await getDb().select().from(discoverySegments)
      .orderBy(desc(discoverySegments.priority), discoverySegments.market, discoverySegments.label);
    return adminJson({ ok: true, items });
  } catch {
    return adminJson({ ok: false, error: "La stratégie de découverte est indisponible." }, 503);
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return adminJson({ ok: false, error: "Corps JSON invalide." }, 400); }
  if (!record(raw)) return adminJson({ ok: false, error: "Configuration invalide." }, 400);
  const database = getDb();
  try {
    if (raw.action === "seedDefaults") {
      const bands = [
        { label: "Découvertes 1–100 €", min: 1, max: 10_000, budget: 48, priority: 65 },
        { label: "Découvertes 100–500 €", min: 10_001, max: 50_000, budget: 72, priority: 80 },
        { label: "Découvertes 500 € et plus", min: 50_001, max: 100_000_000, budget: 48, priority: 60 },
      ];
      const values = await Promise.all([...MARKETS].flatMap((market) => bands.map(async (band) => ({
        id: await idFor(`${market}:${band.label}`),
        source: "amazon",
        market,
        label: band.label,
        categoryIdsJson: "[]",
        minPriceCents: band.min,
        maxPriceCents: band.max,
        minimumDropPercent: 30,
        dailyTokenBudget: band.budget,
        cadenceMinutes: 60,
        priority: band.priority,
        enabled: true,
      }))));
      await database.insert(discoverySegments).values(values).onConflictDoNothing();
      return adminJson({ ok: true, seeded: values.length }, 201);
    }
    const market = typeof raw.market === "string" ? raw.market.trim().toUpperCase() : "";
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 120) : "";
    if (!MARKETS.has(market) || !label) throw new Error("Marché ou nom invalide.");
    const minPriceCents = integer(raw.minPriceCents ?? 1, "minPriceCents", 1, 100_000_000);
    const maxPriceCents = integer(raw.maxPriceCents ?? 100_000_000, "maxPriceCents", minPriceCents, 100_000_000);
    const item = {
      id: await idFor(`${market}:${label}`),
      source: "amazon",
      market,
      label,
      categoryIdsJson: JSON.stringify(categories(raw.categoryIds)),
      minPriceCents,
      maxPriceCents,
      minimumDropPercent: integer(raw.minimumDropPercent ?? 30, "minimumDropPercent", 20, 90),
      dailyTokenBudget: integer(raw.dailyTokenBudget ?? 48, "dailyTokenBudget", 1, 100_000),
      cadenceMinutes: integer(raw.cadenceMinutes ?? 60, "cadenceMinutes", 15, 1_440),
      priority: integer(raw.priority ?? 50, "priority", 0, 100),
      enabled: true,
    };
    await database.insert(discoverySegments).values(item).onConflictDoUpdate({
      target: [discoverySegments.market, discoverySegments.label],
      set: { ...item, updatedAt: new Date().toISOString() },
    });
    return adminJson({ ok: true, item }, 201);
  } catch (error) {
    return adminJson({ ok: false, error: error instanceof Error ? error.message : "Configuration invalide." }, 400);
  }
}

export async function PATCH(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return adminJson({ ok: false, error: "Corps JSON invalide." }, 400); }
  if (!record(raw) || typeof raw.id !== "string") return adminJson({ ok: false, error: "Segment invalide." }, 400);
  try {
    const patch: Partial<typeof discoverySegments.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (raw.enabled !== undefined) {
      if (typeof raw.enabled !== "boolean") throw new Error("enabled est invalide.");
      patch.enabled = raw.enabled;
    }
    if (raw.dailyTokenBudget !== undefined) patch.dailyTokenBudget = integer(raw.dailyTokenBudget, "dailyTokenBudget", 1, 100_000);
    if (raw.priority !== undefined) patch.priority = integer(raw.priority, "priority", 0, 100);
    const [item] = await getDb().update(discoverySegments).set(patch)
      .where(eq(discoverySegments.id, raw.id)).returning();
    if (!item) return adminJson({ ok: false, error: "Segment introuvable." }, 404);
    return adminJson({ ok: true, item });
  } catch (error) {
    return adminJson({ ok: false, error: error instanceof Error ? error.message : "Modification invalide." }, 400);
  }
}
