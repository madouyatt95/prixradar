import { desc, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { socialCollectionRuns, socialPublications, socialSources } from "@/db/schema";
import { authenticateSocialCollector, currentMonthStart, socialMonthlyBudgetMicros } from "./server-auth";

export const dynamic = "force-dynamic";

function boundedLimit(value: string | null) {
  if (value === null) return 40;
  if (!/^\d{1,2}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= 60 ? parsed : null;
}

function boundedOffset(value: string | null) {
  if (value === null) return 0;
  if (!/^\d{1,5}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 0 && parsed <= 20_000 ? parsed : null;
}

export async function GET(request: Request) {
  const privateRequest = request.headers.has("authorization");
  if (privateRequest && !(await authenticateSocialCollector(request))) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const search = new URL(request.url).searchParams;
  const limit = boundedLimit(search.get("limit"));
  const offset = boundedOffset(search.get("offset"));
  const platform = search.get("platform")?.trim().toLowerCase() ?? "";
  if (limit === null || offset === null || (platform !== "" && platform !== "facebook" && platform !== "x")) {
    return Response.json({ ok: false, error: "Filtre invalide." }, { status: 400 });
  }

  try {
    const database = getDb();
    const sourceFilter = platform === "facebook" || platform === "x"
      ? eq(socialSources.platform, platform)
      : undefined;
    const [sources, items, usage] = await Promise.all([
      database.select().from(socialSources).orderBy(socialSources.platform, socialSources.name),
      database.select({
        id: socialPublications.id,
        sourceId: socialPublications.sourceId,
        platform: socialSources.platform,
        sourceName: socialSources.name,
        sourceStatus: socialSources.status,
        externalId: socialPublications.externalId,
        author: socialPublications.author,
        text: socialPublications.text,
        publicationUrl: socialPublications.publicationUrl,
        imageUrl: socialPublications.imageUrl,
        externalUrl: socialPublications.externalUrl,
        publishedAt: socialPublications.publishedAt,
        firstSeenAt: socialPublications.firstSeenAt,
      }).from(socialPublications)
        .innerJoin(socialSources, eq(socialSources.id, socialPublications.sourceId))
        .where(sourceFilter)
        .orderBy(desc(socialPublications.publishedAt), desc(socialPublications.firstSeenAt))
        .limit(limit)
        .offset(offset),
      database.select({
        micros: sql<number>`coalesce(sum(${socialCollectionRuns.estimatedCostMicros}), 0)`,
      }).from(socialCollectionRuns).where(gte(socialCollectionRuns.startedAt, currentMonthStart())),
    ]);
    const usedMicros = Math.max(0, Number(usage[0]?.micros ?? 0));
    const limitMicros = socialMonthlyBudgetMicros();

    return Response.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      cadenceMinutes: 5,
      sources: sources.map((source) => ({
        id: source.id,
        platform: source.platform,
        name: source.name,
        url: source.url,
        enabled: source.enabled,
        status: source.status,
        cadenceMinutes: source.cadenceMinutes,
        lastSuccessAt: source.lastSuccessAt,
        lastErrorCode: source.lastErrorCode,
      })),
      count: items.length,
      items,
      collectionBudget: {
        usedMicros,
        limitMicros,
        remainingMicros: Math.max(0, limitMicros - usedMicros),
      },
    }, {
      headers: { "Cache-Control": privateRequest ? "no-store" : "public, max-age=20, stale-while-revalidate=60" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return Response.json({
      ok: false,
      code: message.includes("no such table") ? "SOCIAL_INITIALIZING" : "SOCIAL_UNAVAILABLE",
      sources: [],
      items: [],
    }, {
      status: message.includes("no such table") ? 503 : 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
