import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { socialCollectionRuns } from "@/db/schema";
import { authenticateSocialCollector } from "../server-auth";

export const dynamic = "force-dynamic";

type UnknownRecord = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  if (!(await authenticateSocialCollector(request))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, code: "INVALID_JSON" }, 400);
  }
  if (!isRecord(body)) return json({ ok: false, code: "INVALID_BODY" }, 400);
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const status = body.status === "succeeded" || body.status === "failed" ? body.status : null;
  const postsReturned = Number(body.postsReturned);
  if (!/^facebook:[0-9a-f-]{36}$/u.test(runId) || !status || !Number.isSafeInteger(postsReturned) || postsReturned < 0 || postsReturned > 1_000) {
    return json({ ok: false, code: "INVALID_CHECKPOINT" }, 422);
  }

  const database = getDb();
  try {
    const [run] = await database.select().from(socialCollectionRuns).where(eq(socialCollectionRuns.id, runId)).limit(1);
    if (!run) return json({ ok: false, code: "UNKNOWN_RUN" }, 404);
    if (run.status !== "reserved") {
      return json({ ok: true, duplicate: true, status: run.status, estimatedCostMicros: run.estimatedCostMicros });
    }

    const usageTotalUsd = typeof body.usageTotalUsd === "number" && Number.isFinite(body.usageTotalUsd)
      && body.usageTotalUsd >= 0 && body.usageTotalUsd <= 100
      ? body.usageTotalUsd
      : null;
    const actualMicros = usageTotalUsd === null
      ? status === "succeeded" ? 1_000 + postsReturned * 7_000 : run.estimatedCostMicros
      : Math.ceil(usageTotalUsd * 1_000_000);
    const finishedAtMs = Date.parse(typeof body.finishedAt === "string" ? body.finishedAt : "");
    const finishedAt = Number.isFinite(finishedAtMs) ? new Date(finishedAtMs).toISOString() : new Date().toISOString();
    const providerRunId = typeof body.providerRunId === "string" && /^[A-Za-z0-9]{8,32}$/u.test(body.providerRunId)
      ? body.providerRunId
      : null;
    const errorCode = status === "failed" && typeof body.errorCode === "string"
      ? body.errorCode.replace(/[^A-Z0-9_:-]/gu, "").slice(0, 80) || "SOCIAL_PROVIDER_FAILED"
      : null;

    await database.update(socialCollectionRuns).set({
      status,
      postsReturned,
      estimatedCostMicros: actualMicros,
      providerRunId,
      finishedAt,
      errorCode,
      updatedAt: finishedAt,
    }).where(eq(socialCollectionRuns.id, runId));
    return json({ ok: true, duplicate: false, status, estimatedCostMicros: actualMicros });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) return json({ ok: false, code: "SOCIAL_NOT_READY" }, 503);
    console.error(JSON.stringify({ event: "social_checkpoint_failed", runId, error: message.slice(0, 160) }));
    return json({ ok: false, code: "SOCIAL_CHECKPOINT_FAILED" }, 500);
  }
}
