import { runtimeEnv as env } from "@/lib/runtime-env";
import { eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { sentinelFrontier, sourceConfigurations, sourceCoverageProducts } from "@/db/schema";
import { parseCoverageProductUrl } from "@/lib/merchant-url";
import { sentinelPriority } from "@/lib/autonomy";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function authenticated(request: Request) {
  const configured = (env as unknown as { INGEST_SECRET?: unknown }).INGEST_SECRET;
  const expected = typeof configured === "string" ? configured : process.env.INGEST_SECRET;
  const received = /^Bearer ([^\s]{1,512})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!expected || expected.length < 24) return false;
  const [left, right] = await Promise.all([digest(received), digest(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function idFor(url: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)));
  return `frontier:${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 32)}`;
}

export async function POST(request: Request) {
  if (!(await authenticated(request))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, code: "INVALID_JSON" }, 400); }
  const record = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const values = Array.isArray(record.items) ? record.items.slice(0, 100) : [];
  const now = new Date().toISOString();
  const database = getDb();
  const hasInvalidConfigurationId = values.some((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = (value as Record<string, unknown>).sourceConfigurationId;
    return candidate !== undefined && candidate !== null
      && (typeof candidate !== "string" || !/^[A-Za-z0-9._:-]{3,160}$/.test(candidate));
  });
  if (hasInvalidConfigurationId) {
    return json({ ok: false, code: "INVALID_SOURCE_CONFIGURATION", error: "Un identifiant de segment est invalide." }, 400);
  }
  const requestedConfigurationIds = [...new Set(values.flatMap((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const candidate = (value as Record<string, unknown>).sourceConfigurationId;
    return typeof candidate === "string" && /^[A-Za-z0-9._:-]{3,160}$/.test(candidate) ? [candidate] : [];
  }))];
  const configurations = requestedConfigurationIds.length === 0
    ? []
    : await database.select().from(sourceConfigurations)
      .where(inArray(sourceConfigurations.id, requestedConfigurationIds));
  if (configurations.length !== requestedConfigurationIds.length) {
    return json({ ok: false, code: "SOURCE_CONFIGURATION_NOT_FOUND", error: "Un segment de couverture n’existe plus." }, 409);
  }
  const configurationById = new Map(configurations.map((configuration) => [configuration.id, configuration]));
  const parsedItems: Array<{
    index: number;
    item: Record<string, unknown>;
    product: NonNullable<ReturnType<typeof parseCoverageProductUrl>>;
    configuration: typeof sourceConfigurations.$inferSelect | null;
  }> = [];
  for (const [index, value] of values.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const product = parseCoverageProductUrl(typeof item.url === "string" ? item.url : "");
    const configurationId = typeof item.sourceConfigurationId === "string" ? item.sourceConfigurationId : null;
    if (!product) {
      if (configurationId !== null) {
        return json({ ok: false, code: "INVALID_COVERAGE_PRODUCT", error: "Une URL rattachée au segment n’est pas une fiche produit reconnue." }, 422);
      }
      continue;
    }
    const configuration = configurationId === null ? null : configurationById.get(configurationId) ?? null;
    if (configuration !== null && !configuration.enabled) {
      return json({ ok: false, code: "SOURCE_CONFIGURATION_DISABLED", error: "Le segment de couverture a été suspendu." }, 409);
    }
    if (configuration !== null && (configuration.source !== product.source || configuration.market !== product.market)) {
      return json({ ok: false, code: "SOURCE_CONFIGURATION_MISMATCH", error: "Le produit ne correspond pas au segment déclaré." }, 409);
    }
    parsedItems.push({ index, item, product, configuration });
  }
  const touchedConfigurations = new Set<string>();
  let accepted = 0;
  for (const { index, item, product, configuration } of parsedItems) {
    const depth = Number.isSafeInteger(item.depth) ? Math.max(0, Math.min(12, Number(item.depth))) : 1;
    const discoveredFrom = typeof item.discoveredFrom === "string" ? item.discoveredFrom.slice(0, 2048) : null;
    const id = await idFor(product.url);
    const priority = sentinelPriority({ depth, anomalyHits: 0, duplicates: 0, blocked: false, ageMinutes: 0 });
    await database.insert(sentinelFrontier).values({
      id, url: product.url, source: product.source, market: product.market,
      discoveredFrom, discoveryType: index === 0 ? "seed" : "link", depth,
      status: "queued", priority, lastSeenAt: now, nextScanAt: now, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: sentinelFrontier.url,
      set: {
        lastSeenAt: now,
        discoveredFrom,
        duplicateCount: sql`${sentinelFrontier.duplicateCount} + 1`,
        priority,
        updatedAt: now,
      },
    });
    if (configuration !== null) {
      await database.insert(sourceCoverageProducts).values({
        sourceConfigurationId: configuration.id,
        productKey: product.productKey,
        productUrl: product.url,
        firstSeenAt: now,
        lastSeenAt: now,
      }).onConflictDoUpdate({
        target: [sourceCoverageProducts.sourceConfigurationId, sourceCoverageProducts.productKey],
        set: { productUrl: product.url, lastSeenAt: now },
      });
      touchedConfigurations.add(configuration.id);
    }
    accepted += 1;
  }
  for (const configurationId of touchedConfigurations) {
    const configuration = configurationById.get(configurationId);
    if (!configuration) continue;
    const [coverage] = await database.select({ total: sql<number>`count(*)` })
      .from(sourceCoverageProducts)
      .where(eq(sourceCoverageProducts.sourceConfigurationId, configurationId));
    const uniqueProductsSeen = Number(coverage?.total ?? 0);
    const coveragePercent = configuration.estimatedProductCount && configuration.estimatedProductCount > 0
      ? Math.max(0, Math.min(100, Math.round((uniqueProductsSeen / configuration.estimatedProductCount) * 100)))
      : 0;
    await database.update(sourceConfigurations).set({ uniqueProductsSeen, coveragePercent, updatedAt: now })
      .where(eq(sourceConfigurations.id, configurationId));
  }
  return json({ ok: true, accepted }, 202);
}
