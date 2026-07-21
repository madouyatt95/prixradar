import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { sourceConfigurations } from "@/db/schema";
import { adminJson, authorizeAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const SOURCES = new Set(["amazon", "boulanger", "darty", "cdiscount"]);
const MARKETS = new Set(["FR", "DE", "IT", "ES", "GB"]);
const HOSTS: Record<string, readonly string[]> = {
  amazon: ["amazon.fr", "amazon.de", "amazon.it", "amazon.es", "amazon.co.uk"],
  boulanger: ["boulanger.com"],
  darty: ["darty.com"],
  cdiscount: ["cdiscount.com"],
};

function text(value: unknown, field: string, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${field} est invalide.`);
  return value.trim();
}

function sourceValue(value: unknown) {
  const source = text(value, "source", 24).toLowerCase();
  if (!SOURCES.has(source)) throw new Error("source n’est pas prise en charge.");
  return source;
}

function marketValue(source: string, value: unknown) {
  const market = text(value, "market", 8).toUpperCase();
  if (!MARKETS.has(market) || (source !== "amazon" && market !== "FR")) throw new Error("market est invalide.");
  return market;
}

function discoveryUrl(source: string, value: unknown) {
  const url = new URL(text(value, "discoveryUrl", 2_048));
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !HOSTS[source]?.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new Error("L’URL ne correspond pas à la source déclarée.");
  }
  url.hash = "";
  return url.toString();
}

function integer(value: unknown, field: string, min: number, max: number, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${field} est invalide.`);
  return value as number;
}

async function configurationId(source: string, market: string, url: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${source}:${market}:${url}`));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 20);
  return `${source}:${market.toLowerCase()}:${hash}`;
}

export async function GET(request: Request) {
  const authorization = authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  try {
    const items = await getDb().select().from(sourceConfigurations).orderBy(sourceConfigurations.source, sourceConfigurations.category);
    return adminJson({ ok: true, items });
  } catch {
    return adminJson({ ok: false, code: "SOURCE_CONFIG_FAILED", error: "La configuration des sources est indisponible." }, 503);
  }
}

export async function POST(request: Request) {
  const authorization = authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const source = sourceValue(body.source);
    const market = marketValue(source, body.market ?? "FR");
    const url = discoveryUrl(source, body.discoveryUrl);
    const id = await configurationId(source, market, url);
    const values = {
      id,
      source,
      market,
      displayName: text(body.displayName ?? source, "displayName", 120),
      discoveryUrl: url,
      category: text(body.category ?? "Général", "category", 80),
      enabled: body.enabled !== false,
      cadenceMinutes: integer(body.cadenceMinutes, "cadenceMinutes", 15, 1_440, 60),
      volatilityScore: integer(body.volatilityScore, "volatilityScore", 0, 100, 50),
      updatedAt: new Date().toISOString(),
    };
    await getDb().insert(sourceConfigurations).values(values).onConflictDoUpdate({
      target: sourceConfigurations.id,
      set: {
        displayName: values.displayName,
        category: values.category,
        enabled: values.enabled,
        cadenceMinutes: values.cadenceMinutes,
        volatilityScore: values.volatilityScore,
        updatedAt: values.updatedAt,
      },
    });
    return adminJson({ ok: true, item: values }, 201);
  } catch (error) {
    return adminJson({ ok: false, code: "INVALID_SOURCE_CONFIG", error: error instanceof Error ? error.message : "Configuration invalide." }, 400);
  }
}

export async function PATCH(request: Request) {
  const authorization = authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id, "id", 160);
    const patch: Partial<typeof sourceConfigurations.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") throw new Error("enabled doit être un booléen.");
      patch.enabled = body.enabled;
      patch.pausedReason = body.enabled ? null : text(body.pausedReason ?? "Suspendue depuis le centre de pilotage", "pausedReason", 240);
    }
    if (body.cadenceMinutes !== undefined) patch.cadenceMinutes = integer(body.cadenceMinutes, "cadenceMinutes", 15, 1_440, 60);
    if (body.volatilityScore !== undefined) patch.volatilityScore = integer(body.volatilityScore, "volatilityScore", 0, 100, 50);
    if (body.category !== undefined) patch.category = text(body.category, "category", 80);
    const [item] = await getDb().update(sourceConfigurations).set(patch).where(eq(sourceConfigurations.id, id)).returning();
    if (!item) return adminJson({ ok: false, code: "SOURCE_CONFIG_NOT_FOUND", error: "Source introuvable." }, 404);
    return adminJson({ ok: true, item });
  } catch (error) {
    return adminJson({ ok: false, code: "INVALID_SOURCE_CONFIG", error: error instanceof Error ? error.message : "Configuration invalide." }, 400);
  }
}
