import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { sourceConfigurations } from "@/db/schema";
import { adminJson, authorizeAdmin } from "@/lib/admin";
import { runtimeEnv as env } from "@/lib/runtime-env";
import {
  isActiveSource,
  isPartnerRequiredSource,
  isPartnerSourceAuthorized,
  sourceDefinition,
} from "@/lib/source-registry";

export const dynamic = "force-dynamic";

const MARKETS = new Set(["FR", "DE", "IT", "ES", "GB"]);

function authorizedPartnerSources() {
  const value = (env as unknown as { AUTHORIZED_PARTNER_SOURCES?: unknown }).AUTHORIZED_PARTNER_SOURCES;
  return typeof value === "string" ? value : undefined;
}

function enabledValue(source: string, value: unknown) {
  if (value !== undefined && typeof value !== "boolean") throw new Error("enabled doit être un booléen.");
  const enabled = value === undefined ? !isPartnerRequiredSource(source) : value;
  return enabled as boolean;
}

function text(value: unknown, field: string, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(`${field} est invalide.`);
  return value.trim();
}

function sourceValue(value: unknown) {
  const source = text(value, "source", 24).toLowerCase();
  if (!isActiveSource(source)) throw new Error("source n’est pas prise en charge.");
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
  const definition = sourceDefinition(source);
  if (url.protocol !== "https:" || url.username || url.password || !definition?.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
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

function discoveryStrategy(value: unknown) {
  const strategy = value === undefined ? "links" : text(value, "discoveryStrategy", 16).toLowerCase();
  if (strategy !== "links") {
    throw new Error("Seule la découverte par liens est active. Sitemap, flux et API restent désactivés jusqu’à leur connecteur dédié.");
  }
  return strategy;
}

function optionalPositiveInteger(value: unknown, field: string) {
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100_000_000) {
    throw new Error(`${field} est invalide.`);
  }
  return value as number;
}

async function configurationId(source: string, market: string, url: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${source}:${market}:${url}`));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 20);
  return `${source}:${market.toLowerCase()}:${hash}`;
}

export async function GET(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  try {
    const items = await getDb().select().from(sourceConfigurations).orderBy(sourceConfigurations.source, sourceConfigurations.category);
    return adminJson({ ok: true, items });
  } catch {
    return adminJson({ ok: false, code: "SOURCE_CONFIG_FAILED", error: "La configuration des sources est indisponible." }, 503);
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const source = sourceValue(body.source);
    const market = marketValue(source, body.market ?? "FR");
    const url = discoveryUrl(source, body.discoveryUrl);
    const id = await configurationId(source, market, url);
    const enabled = enabledValue(source, body.enabled);
    if (enabled && !isPartnerSourceAuthorized(source, authorizedPartnerSources())) {
      return adminJson({
        ok: false,
        code: "PARTNER_AUTHORIZATION_REQUIRED",
        error: "Cette source exige un accord partenaire et son identifiant dans AUTHORIZED_PARTNER_SOURCES.",
      }, 409);
    }
    const values = {
      id,
      source,
      market,
      displayName: text(body.displayName ?? source, "displayName", 120),
      discoveryUrl: url,
      category: text(body.category ?? "Général", "category", 80),
      discoveryStrategy: discoveryStrategy(body.discoveryStrategy),
      estimatedProductCount: optionalPositiveInteger(body.estimatedProductCount, "estimatedProductCount"),
      enabled,
      cadenceMinutes: integer(body.cadenceMinutes, "cadenceMinutes", 15, 1_440, 60),
      volatilityScore: integer(body.volatilityScore, "volatilityScore", 0, 100, 50),
      dailyProductBudget: integer(body.dailyProductBudget, "dailyProductBudget", 1, 100_000, 500),
      pausedReason: enabled
        ? null
        : isPartnerRequiredSource(source) ? "PARTNER_AUTHORIZATION_REQUIRED" : "Suspendue depuis le centre de pilotage",
      updatedAt: new Date().toISOString(),
    };
    await getDb().insert(sourceConfigurations).values(values).onConflictDoUpdate({
      target: sourceConfigurations.id,
      set: {
        displayName: values.displayName,
        category: values.category,
        discoveryStrategy: values.discoveryStrategy,
        estimatedProductCount: values.estimatedProductCount,
        enabled: values.enabled,
        cadenceMinutes: values.cadenceMinutes,
        volatilityScore: values.volatilityScore,
        dailyProductBudget: values.dailyProductBudget,
        pausedReason: values.pausedReason,
        updatedAt: values.updatedAt,
      },
    });
    return adminJson({ ok: true, item: values }, 201);
  } catch (error) {
    return adminJson({ ok: false, code: "INVALID_SOURCE_CONFIG", error: error instanceof Error ? error.message : "Configuration invalide." }, 400);
  }
}

export async function PATCH(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = text(body.id, "id", 160);
    const database = getDb();
    const [existing] = await database.select({ source: sourceConfigurations.source })
      .from(sourceConfigurations)
      .where(eq(sourceConfigurations.id, id))
      .limit(1);
    if (!existing) return adminJson({ ok: false, code: "SOURCE_CONFIG_NOT_FOUND", error: "Source introuvable." }, 404);
    const patch: Partial<typeof sourceConfigurations.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") throw new Error("enabled doit être un booléen.");
      if (body.enabled && !isPartnerSourceAuthorized(existing.source, authorizedPartnerSources())) {
        return adminJson({
          ok: false,
          code: "PARTNER_AUTHORIZATION_REQUIRED",
          error: "Cette source ne peut pas être activée sans accord partenaire configuré.",
        }, 409);
      }
      patch.enabled = body.enabled;
      patch.pausedReason = body.enabled ? null : text(body.pausedReason ?? "Suspendue depuis le centre de pilotage", "pausedReason", 240);
    }
    if (body.cadenceMinutes !== undefined) patch.cadenceMinutes = integer(body.cadenceMinutes, "cadenceMinutes", 15, 1_440, 60);
    if (body.volatilityScore !== undefined) patch.volatilityScore = integer(body.volatilityScore, "volatilityScore", 0, 100, 50);
    if (body.dailyProductBudget !== undefined) patch.dailyProductBudget = integer(body.dailyProductBudget, "dailyProductBudget", 1, 100_000, 500);
    if (body.category !== undefined) patch.category = text(body.category, "category", 80);
    if (body.discoveryStrategy !== undefined) patch.discoveryStrategy = discoveryStrategy(body.discoveryStrategy);
    if (body.estimatedProductCount !== undefined) patch.estimatedProductCount = optionalPositiveInteger(body.estimatedProductCount, "estimatedProductCount");
    if (body.resetCircuit !== undefined) {
      if (body.resetCircuit !== true) throw new Error("resetCircuit doit être true.");
      patch.circuitState = "closed";
      patch.failureStreak = 0;
      patch.antiBotStreak = 0;
      patch.circuitOpenedAt = null;
      patch.cooldownUntil = null;
      patch.lastErrorCode = null;
      patch.pausedReason = null;
    }
    const [item] = await database.update(sourceConfigurations).set(patch).where(eq(sourceConfigurations.id, id)).returning();
    return adminJson({ ok: true, item });
  } catch (error) {
    return adminJson({ ok: false, code: "INVALID_SOURCE_CONFIG", error: error instanceof Error ? error.message : "Configuration invalide." }, 400);
  }
}
