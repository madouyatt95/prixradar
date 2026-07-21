import { env } from "cloudflare:workers";
import { asc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { sourceConfigurations } from "@/db/schema";

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

export async function GET(request: Request) {
  const expected = ingestSecret();
  const token = /^Bearer ([^\s]{1,512})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (expected === null) return json({ ok: false, code: "INGEST_NOT_CONFIGURED" }, 503);
  if (!token || !(await equalSecret(token, expected))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);

  try {
    const rows = await getDb()
      .select()
      .from(sourceConfigurations)
      .where(eq(sourceConfigurations.enabled, true))
      .orderBy(asc(sourceConfigurations.lastRunAt), asc(sourceConfigurations.source));
    const now = Date.now();
    const seen = new Set<string>();
    const items = rows.flatMap((row) => {
      const cadenceMinutes = effectiveCadence(row.cadenceMinutes, row.volatilityScore);
      const due = row.lastRunAt === null || now - Date.parse(row.lastRunAt) >= cadenceMinutes * 60_000;
      const normalizedUrl = row.discoveryUrl.toLowerCase().replace(/\/$/u, "");
      if (!due || seen.has(normalizedUrl)) return [];
      seen.add(normalizedUrl);
      return [{
        id: row.id,
        source: row.source,
        market: row.market,
        category: row.category,
        discoveryUrl: row.discoveryUrl,
        cadenceMinutes,
        volatilityScore: row.volatilityScore,
      }];
    });
    return json({ ok: true, generatedAt: new Date(now).toISOString(), count: items.length, items });
  } catch {
    return json({ ok: false, code: "SOURCE_PLAN_UNAVAILABLE" }, 503);
  }
}
