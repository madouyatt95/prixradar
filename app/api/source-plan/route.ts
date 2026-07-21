import { runtimeEnv as env } from "@/lib/runtime-env";
import { asc, desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { discoverySegments, sourceConfigurations } from "@/db/schema";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function equalSecret(left: string, right: string) {
  const [a, b] = await Promise.all([hash(left), hash(right)]);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function ingestSecret() {
  const worker = (env as unknown as { INGEST_SECRET?: unknown }).INGEST_SECRET;
  if (typeof worker === "string" && worker.length >= 24) return worker;
  return typeof process.env.INGEST_SECRET === "string" && process.env.INGEST_SECRET.length >= 24
    ? process.env.INGEST_SECRET
    : null;
}

function effectiveCadence(cadenceMinutes: number, volatilityScore: number) {
  if (volatilityScore >= 70) return Math.max(15, Math.floor(cadenceMinutes / 2));
  if (volatilityScore <= 20) return Math.min(1_440, cadenceMinutes * 2);
  return cadenceMinutes;
}

function categoryIds(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((item): item is number => Number.isSafeInteger(item) && item > 0))].slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const expected = ingestSecret();
  const token = /^Bearer ([^\s]{1,512})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (expected === null) return json({ ok: false, code: "INGEST_NOT_CONFIGURED" }, 503);
  if (!token || !(await equalSecret(token, expected))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);

  try {
    const database = getDb();
    const [rows, segments] = await Promise.all([
      database
        .select()
        .from(sourceConfigurations)
        .where(eq(sourceConfigurations.enabled, true))
        .orderBy(asc(sourceConfigurations.lastRunAt), asc(sourceConfigurations.source)),
      database
        .select()
        .from(discoverySegments)
        .where(eq(discoverySegments.enabled, true))
        .orderBy(desc(discoverySegments.priority), asc(discoverySegments.lastRunAt)),
    ]);
    const now = Date.now();
    const seen = new Set<string>();
    const items = rows.flatMap((row) => {
      const cadenceMinutes = effectiveCadence(row.cadenceMinutes, row.volatilityScore);
      const due = row.lastRunAt === null || now - Date.parse(row.lastRunAt) >= cadenceMinutes * 60_000;
      const probeOnly = row.circuitState === "open";
      const cooldownElapsed = row.cooldownUntil === null || Date.parse(row.cooldownUntil) <= now;
      const normalizedUrl = row.discoveryUrl.toLowerCase().replace(/\/$/u, "");
      if (!due || seen.has(normalizedUrl) || (probeOnly && !cooldownElapsed)) return [];
      seen.add(normalizedUrl);
      return [{
        id: row.id,
        source: row.source,
        market: row.market,
        category: row.category,
        discoveryUrl: row.discoveryUrl,
        cadenceMinutes,
        volatilityScore: row.volatilityScore,
        circuitState: row.circuitState,
        probeOnly,
        productLimit: probeOnly ? 1 : row.dailyProductBudget,
      }];
    });
    const discoveryItems = segments.flatMap((segment) => {
      const due = segment.lastRunAt === null || now - Date.parse(segment.lastRunAt) >= segment.cadenceMinutes * 60_000;
      if (!due) return [];
      const runsPerDay = Math.max(1, Math.ceil(1_440 / segment.cadenceMinutes));
      const perRunLimit = Math.max(1, Math.min(100, Math.floor(segment.dailyTokenBudget / runsPerDay)));
      const page = Math.floor(now / (segment.cadenceMinutes * 60_000)) % 10;
      return [{
        id: segment.id,
        source: "amazon" as const,
        market: segment.market,
        label: segment.label,
        categoryIds: categoryIds(segment.categoryIdsJson),
        minPriceCents: segment.minPriceCents,
        maxPriceCents: segment.maxPriceCents,
        minimumDropPercent: segment.minimumDropPercent,
        limit: perRunLimit,
        page,
        priority: segment.priority,
        dailyTokenBudget: segment.dailyTokenBudget,
      }];
    });
    if (discoveryItems.length > 0) {
      const claimedAt = new Date(now).toISOString();
      for (const segment of discoveryItems) {
        await database.update(discoverySegments).set({ lastRunAt: claimedAt, updatedAt: claimedAt })
          .where(eq(discoverySegments.id, segment.id));
      }
    }
    return json({
      ok: true,
      generatedAt: new Date(now).toISOString(),
      count: items.length,
      items,
      discoveryCount: discoveryItems.length,
      discoverySegments: discoveryItems,
    });
  } catch {
    return json({ ok: false, code: "SOURCE_PLAN_UNAVAILABLE" }, 503);
  }
}
