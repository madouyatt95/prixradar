import { eq, gte, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { collectionRuns, sentinelFrontier, sourceConfigurations, sourceCoverageProducts } from "@/db/schema";
import { adminJson, authorizeAdmin } from "@/lib/admin";
import { SOURCE_REGISTRY } from "@/lib/source-registry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  try {
    const database = getDb();
    const [configurations, frontier, runs, coverage] = await Promise.all([
      database.select().from(sourceConfigurations),
      database.select({
        source: sentinelFrontier.source,
        market: sentinelFrontier.market,
        total: sql<number>`count(*)`,
        queued: sql<number>`sum(case when ${sentinelFrontier.status} in ('queued', 'processing') then 1 else 0 end)`,
        blocked: sql<number>`sum(case when ${sentinelFrontier.status} = 'blocked' then 1 else 0 end)`,
      }).from(sentinelFrontier).groupBy(sentinelFrontier.source, sentinelFrontier.market),
      database.select({
        source: collectionRuns.source,
        market: collectionRuns.market,
        productsSeen: sql<number>`coalesce(sum(${collectionRuns.productsSeen}), 0)`,
        antiBotBlocks: sql<number>`sum(case when ${collectionRuns.antiBotBlocked} = 1 then 1 else 0 end)`,
      }).from(collectionRuns).where(gte(collectionRuns.attemptedAt, since)).groupBy(collectionRuns.source, collectionRuns.market),
      database.select({
        source: sourceConfigurations.source,
        market: sourceConfigurations.market,
        total: sql<number>`count(distinct ${sourceCoverageProducts.productKey})`,
      }).from(sourceCoverageProducts)
        .innerJoin(sourceConfigurations, eq(sourceConfigurations.id, sourceCoverageProducts.sourceConfigurationId))
        .where(isNotNull(sourceConfigurations.estimatedProductCount))
        .groupBy(sourceConfigurations.source, sourceConfigurations.market),
    ]);
    const frontierByKey = new Map(frontier.map((item) => [`${item.source}:${item.market}`, item]));
    const runsByKey = new Map(runs.map((item) => [`${item.source}:${item.market}`, item]));
    const coverageByKey = new Map(coverage.map((item) => [`${item.source}:${item.market}`, Number(item.total)]));
    const items = SOURCE_REGISTRY.flatMap((definition) => definition.markets.map((market) => {
      const matching = configurations.filter((item) => item.source === definition.id && item.market === market);
      const calibrated = matching.filter((item) => item.estimatedProductCount !== null);
      const key = `${definition.id}:${market}`;
      const estimated = calibrated.reduce((total, item) => total + Number(item.estimatedProductCount), 0);
      const uniqueSeen = coverageByKey.get(key) ?? 0;
      const categories = new Set(matching.map((item) => item.category));
      const frontierMetrics = frontierByKey.get(key);
      const runMetrics = runsByKey.get(key);
      return {
        source: definition.id,
        displayName: definition.displayName,
        market,
        status: definition.status,
        adapterVersion: definition.adapterVersion,
        verification: definition.verification,
        configuredSegments: matching.length,
        calibratedSegments: calibrated.length,
        uncalibratedSegments: matching.length - calibrated.length,
        enabledSegments: matching.filter((item) => item.enabled).length,
        categories: categories.size,
        estimatedProducts: estimated || null,
        uniqueProductsSeen: uniqueSeen,
        estimatedCoveragePercent: estimated > 0 ? Math.min(100, Math.round((uniqueSeen / estimated) * 100)) : null,
        contractStatus: matching.length === 0
          ? "unconfigured"
          : matching.some((item) => item.contractStatus === "failing")
            ? "failing"
            : matching.every((item) => item.contractStatus === "passing") ? "passing" : "degraded",
        frontier: {
          total: Number(frontierMetrics?.total ?? 0),
          queued: Number(frontierMetrics?.queued ?? 0),
          blocked: Number(frontierMetrics?.blocked ?? 0),
        },
        lastSevenDays: {
          productsSeen: Number(runMetrics?.productsSeen ?? 0),
          antiBotBlocks: Number(runMetrics?.antiBotBlocks ?? 0),
        },
      };
    }));
    return adminJson({
      ok: true,
      generatedAt: new Date().toISOString(),
      methodology: "Couverture calibrée = identités produit distinctes observées sur les seuls segments dont la taille de catalogue est renseignée / somme de ces tailles estimées. Un produit présent sur plusieurs pages n’est compté qu’une fois ; des catégories estimées qui se chevauchent peuvent rendre ce taux volontairement conservateur.",
      items,
    });
  } catch {
    return adminJson({ ok: false, code: "COVERAGE_UNAVAILABLE", error: "La couverture ne peut pas encore être calculée." }, 503);
  }
}
