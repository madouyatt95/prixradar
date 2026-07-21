import { runtimeEnv as env } from "@/lib/runtime-env";
import { sql } from "drizzle-orm";

import { getDb } from "@/db";
import { sentinelFrontier } from "@/db/schema";
import { parseMerchantUrl } from "@/lib/merchant-url";
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
  let accepted = 0;
  for (const [index, value] of values.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const merchant = parseMerchantUrl(typeof item.url === "string" ? item.url : "");
    if (!merchant) continue;
    const depth = Number.isSafeInteger(item.depth) ? Math.max(0, Math.min(12, Number(item.depth))) : 1;
    const discoveredFrom = typeof item.discoveredFrom === "string" ? item.discoveredFrom.slice(0, 2048) : null;
    const id = await idFor(merchant.url);
    const priority = sentinelPriority({ depth, anomalyHits: 0, duplicates: 0, blocked: false, ageMinutes: 0 });
    await getDb().insert(sentinelFrontier).values({
      id, url: merchant.url, source: merchant.source, market: merchant.market,
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
    accepted += 1;
  }
  return json({ ok: true, accepted }, 202);
}
