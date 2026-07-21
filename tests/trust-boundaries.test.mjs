import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("only recipients of a sent notification can influence learning and public rates", async () => {
  const [feedback, ingest, metrics] = await Promise.all([
    source("../app/api/feedback/route.ts"),
    source("../app/api/ingest/route.ts"),
    source("../app/api/public/metrics/route.ts"),
  ]);
  assert.match(feedback, /feedback_requires_delivery/u);
  assert.match(feedback, /notificationDeliveries\.status, "sent"/u);
  assert.match(ingest, /count\(distinct case when/u);
  assert.match(ingest, /feedbackSample >= 10/u);
  assert.match(metrics, /selectDistinct/u);
  assert.match(metrics, /notificationDeliveries\.ownerId, alertFeedback\.ownerId/u);
});

test("advanced coverage strategies stay disabled until a real collector exists", async () => {
  const [route, interfaceSource] = await Promise.all([
    source("../app/api/admin/sources/route.ts"),
    source("../app/components/admin-view.tsx"),
  ]);
  assert.match(route, /strategy !== "links"/u);
  assert.match(route, /Sitemap, flux et API restent désactivés/u);
  assert.match(interfaceSource, /value="sitemap" disabled/u);
  assert.match(interfaceSource, /value="api" disabled/u);
});

test("proof wording is neutral until the API returns a certified status", async () => {
  const [interfaceSource, page, client, deliveries, digests, proof] = await Promise.all([
    source("../app/components/price-radar-app.tsx"),
    source("../app/certified/[id]/page.tsx"),
    source("../app/certified/[id]/certificate-client.tsx"),
    source("../app/api/push/deliveries/route.ts"),
    source("../app/api/push/digests/route.ts"),
    source("../lib/public-proof.ts"),
  ]);
  assert.doesNotMatch(interfaceSource, /preuve certifiée/iu);
  assert.doesNotMatch(page, /Preuve certifiée/iu);
  assert.doesNotMatch(client, /PrixRadar Certified/u);
  assert.match(client, /status === "certified"/u);
  assert.match(deliveries, /verifiedCartEvidence/u);
  assert.match(digests, /verifiedCartEvidence/u);
  assert.match(proof, /verifiedCartEvidence/u);
});

test("coverage is scoped, paginated and deduplicated across category pages", async () => {
  const [schema, actor, frontier, ingest, coverage, merchantUrl, migration] = await Promise.all([
    source("../db/schema.ts"),
    source("../services/collector/src/actor.ts"),
    source("../app/api/frontier/route.ts"),
    source("../app/api/ingest/route.ts"),
    source("../app/api/admin/coverage/route.ts"),
    source("../lib/merchant-url.ts"),
    source("../drizzle/0006_wise_tarot.sql"),
  ]);
  assert.match(schema, /sourceCoverageProducts/u);
  assert.match(actor, /sourceConfigurationId/u);
  assert.match(actor, /pageCursor/u);
  assert.match(actor, /nextPageCursor: result\.nextPageUrl/u);
  assert.match(actor, /dataKind: "verification-failure"/u);
  assert.match(actor, /degradedErrorCode/u);
  assert.match(frontier, /insert\(sourceCoverageProducts\)/u);
  assert.match(frontier, /SOURCE_CONFIGURATION_NOT_FOUND/u);
  assert.match(ingest, /eq\(sourceConfigurations\.id, parsed\.sourceConfigurationId\)/u);
  assert.match(ingest, /SOURCE_CONFIGURATION_NOT_FOUND/u);
  assert.match(coverage, /count\(distinct \$\{sourceCoverageProducts\.productKey\}\)/u);
  assert.match(coverage, /isNotNull\(sourceConfigurations\.estimatedProductCount\)/u);
  assert.match(coverage, /Un produit présent sur plusieurs pages n’est compté qu’une fois/u);
  assert.match(merchantUrl, /parseCoverageProductUrl/u);
  assert.match(merchantUrl, /parsed\.search = ""/u);
  assert.match(migration, /source_config_coverage_range/u);
  assert.match(migration, /user_preferences_preset_allowed/u);
});
