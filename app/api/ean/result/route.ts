import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { eanScanRequests } from "@/db/schema";
import { runtimeEnv as env } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sameSecret(left: string, right: string) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  const expected = ingestSecret();
  const token = /^Bearer ([^\s]{1,512})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!expected) return json({ ok: false, code: "INGEST_NOT_CONFIGURED" }, 503);
  if (!token || !(await sameSecret(token, expected))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);
  let body: unknown;
  try { body = await request.json(); } catch { return json({ ok: false, code: "INVALID_JSON" }, 400); }
  if (!record(body)) return json({ ok: false, code: "INVALID_RESULT" }, 400);
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const productsFound = Number.isSafeInteger(body.productsFound) && Number(body.productsFound) >= 0
    ? Math.min(500, Number(body.productsFound))
    : null;
  const marketsChecked = Array.isArray(body.marketsChecked)
    ? [...new Set(body.marketsChecked.filter((item): item is string => typeof item === "string" && /^(?:FR|DE|IT|ES|GB)$/u.test(item)))].slice(0, 5)
    : [];
  const errorCode = typeof body.errorCode === "string" && /^[A-Z0-9_]{3,80}$/u.test(body.errorCode)
    ? body.errorCode
    : null;
  if (!/^ean:[0-9a-f-]{36}$/u.test(id) || productsFound === null) {
    return json({ ok: false, code: "INVALID_RESULT" }, 400);
  }
  try {
    const now = new Date();
    const [updated] = await getDb().update(eanScanRequests).set({
      status: productsFound > 0 ? "matched" : errorCode ? "failed" : "monitoring",
      resultJson: JSON.stringify({ productsFound, marketsChecked, errorCode }),
      claimedAt: null,
      lastCheckedAt: now.toISOString(),
      nextCheckAt: new Date(now.getTime() + (productsFound > 0 ? 60 : 6 * 60) * 60_000).toISOString(),
      updatedAt: now.toISOString(),
    }).where(eq(eanScanRequests.id, id)).returning({ id: eanScanRequests.id, status: eanScanRequests.status });
    if (!updated) return json({ ok: false, code: "EAN_SCAN_NOT_FOUND" }, 404);
    return json({ ok: true, item: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return json({ ok: false, code: message.includes("no such table") ? "EAN_SCAN_NOT_READY" : "EAN_RESULT_FAILED" }, message.includes("no such table") ? 503 : 500);
  }
}
