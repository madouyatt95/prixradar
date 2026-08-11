import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { socialCollectionRuns, socialSources } from "@/db/schema";
import {
  authenticateSocialCollector,
  currentMonthStart,
  socialMonthlyBudgetMicros,
} from "../server-auth";

export const dynamic = "force-dynamic";

const RESULT_LIMIT_PER_SOURCE = 20;
const PERSONAL_ACTOR_RUN_RESERVATION_MICROS = 20_000;
const INITIAL_LOOKBACK_MS = 10 * 60_000;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await authenticateSocialCollector(request))) return json({ ok: false, code: "UNAUTHORIZED" }, 401);

  const now = new Date();
  const startedAt = now.toISOString();
  const database = getDb();
  try {
    const sources = await database.select({
      id: socialSources.id,
      name: socialSources.name,
      url: socialSources.url,
      lastSuccessAt: socialSources.lastSuccessAt,
    }).from(socialSources).where(and(
      eq(socialSources.platform, "facebook"),
      eq(socialSources.enabled, true),
    )).orderBy(socialSources.name);

    if (sources.length === 0) return json({ ok: false, code: "NO_ACTIVE_SOURCE" }, 409);

    const [usage] = await database.select({
      micros: sql<number>`coalesce(sum(${socialCollectionRuns.estimatedCostMicros}), 0)`,
    }).from(socialCollectionRuns).where(gte(socialCollectionRuns.startedAt, currentMonthStart(now)));
    const usedMicros = Math.max(0, Number(usage?.micros ?? 0));
    const limitMicros = socialMonthlyBudgetMicros();
    const reservedMicros = PERSONAL_ACTOR_RUN_RESERVATION_MICROS;
    const remainingMicros = Math.max(0, limitMicros - usedMicros);

    if (remainingMicros < reservedMicros) {
      return json({
        ok: true,
        allowed: false,
        code: "MONTHLY_BUDGET_REACHED",
        usedMicros,
        limitMicros,
        remainingMicros,
      });
    }

    const successfulCursors = sources.map((source) => Date.parse(source.lastSuccessAt ?? ""))
      .filter((value) => Number.isFinite(value));
    const cursorAt = successfulCursors.length > 0
      ? new Date(Math.min(...successfulCursors)).toISOString()
      : new Date(now.getTime() - INITIAL_LOOKBACK_MS).toISOString();
    const runId = `facebook:${crypto.randomUUID()}`;

    await database.insert(socialCollectionRuns).values({
      id: runId,
      status: "reserved",
      sourceCount: sources.length,
      postsReturned: 0,
      estimatedCostMicros: reservedMicros,
      cursorFrom: cursorAt,
      startedAt,
      updatedAt: startedAt,
    });

    return json({
      ok: true,
      allowed: true,
      runId,
      startedAt,
      cursorAt,
      resultLimitPerSource: RESULT_LIMIT_PER_SOURCE,
      sources: sources.map(({ id, name, url }) => ({ id, name, url })),
      budget: { usedMicros, limitMicros, remainingMicros, reservedMicros },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) return json({ ok: false, code: "SOCIAL_NOT_READY" }, 503);
    console.error(JSON.stringify({ event: "social_plan_failed", error: message.slice(0, 160) }));
    return json({ ok: false, code: "SOCIAL_PLAN_FAILED" }, 500);
  }
}
