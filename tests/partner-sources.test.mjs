import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const partnerSources = ["fnac", "carrefour", "leroy_merlin", "castorama", "conforama", "rueducommerce"];

test("recognizes stable product identities for every partner merchant", async () => {
  const merchantUrl = await source("../lib/merchant-url.ts");
  for (const merchant of partnerSources) assert.match(merchantUrl, new RegExp(`merchant\\.source === "${merchant}"`, "u"));
  assert.match(merchantUrl, /externalId: string/u);
  assert.match(merchantUrl, /gtin:\$\{gtin\}/u);
  assert.match(merchantUrl, /ref:\$\{externalId\}/u);
  assert.match(merchantUrl, /\\d\{6,14\}/u);
  assert.match(merchantUrl, /\[A-Z\]\\d\+/u);
  assert.match(merchantUrl, /parseCoverageProductUrl/u);
});

test("keeps partner sources out of every live execution path until authorized", async () => {
  const [admin, coverage, ingest, inspections, plan, publicStatuses, adminView] = await Promise.all([
    source("../app/api/admin/sources/route.ts"),
    source("../app/api/admin/coverage/route.ts"),
    source("../app/api/ingest/route.ts"),
    source("../app/api/inspections/route.ts"),
    source("../app/api/source-plan/route.ts"),
    source("../app/api/sources/route.ts"),
    source("../app/components/admin-view.tsx"),
  ]);
  for (const route of [admin, coverage, ingest, inspections, plan, publicStatuses]) {
    assert.match(route, /AUTHORIZED_PARTNER_SOURCES/u);
    assert.match(route, /isPartnerSourceAuthorized/u);
  }
  assert.match(admin, /value === undefined \? !isPartnerRequiredSource\(source\)/u);
  assert.match(admin, /PARTNER_AUTHORIZATION_REQUIRED/u);
  assert.match(plan, /authorizedSourceIds/u);
  for (const table of ["sourceConfigurations", "recheckRequests", "inspectionRequests", "sentinelFrontier"]) {
    assert.match(plan, new RegExp(`inArray\\(${table}\\.source, authorizedSourceIds\\)`, "u"));
  }
  assert.match(ingest, /PARTNER_AUTHORIZATION_REQUIRED/u);
  assert.match(inspections, /partner_authorization_required/u);
  assert.match(publicStatuses, /inArray\(sourceStatuses\.source, authorizedSourceIds\)/u);
  assert.match(coverage, /effectiveStatus/u);
  assert.match(coverage, /liveHealthy/u);
  assert.match(adminView, /item\.effectiveStatus === "active"/u);
});

test("validates watchlist URLs against merchant identity without activating a collector", async () => {
  const watchlist = await source("../app/api/watchlist/route.ts");
  assert.match(watchlist, /parseMerchantUrl/u);
  assert.match(watchlist, /parseCoverageProductUrl/u);
  assert.match(watchlist, /merchant\.source !== source \|\| merchant\.market !== market/u);
  assert.match(watchlist, /isPartnerRequiredSource\(source\) && !stableProduct/u);
  assert.doesNotMatch(watchlist, /isPartnerSourceAuthorized/u);
});

test("migration 0008 widens all source checks and copies every existing row", async () => {
  const [schema, migration, journal, snapshot] = await Promise.all([
    source("../db/schema.ts"),
    source("../drizzle/0008_chief_liz_osborn.sql"),
    source("../drizzle/meta/_journal.json"),
    source("../drizzle/meta/0008_snapshot.json"),
  ]);
  for (const merchant of partnerSources) {
    assert.match(schema, new RegExp(`'${merchant}'`, "u"));
    assert.match(migration, new RegExp(`'${merchant}'`, "u"));
  }
  for (const table of ["alerts", "inspection_requests", "merchant_products"]) {
    assert.match(migration, new RegExp("INSERT INTO `__new_" + table + "`[\\s\\S]*? FROM `" + table + "`", "u"));
  }
  assert.match(migration, /PRAGMA defer_foreign_keys=ON/u);
  assert.doesNotMatch(migration, /PRAGMA foreign_keys=OFF/u);
  for (const child of ["price_observations", "alert_intelligence", "alert_feedback", "recheck_requests"]) {
    assert.match(migration, new RegExp("CREATE TABLE `__backup_" + child + "` AS SELECT \\* FROM `" + child + "`", "u"));
    assert.match(migration, new RegExp("INSERT INTO `" + child + "`[\\s\\S]*?FROM `__backup_" + child + "`", "u"));
  }
  assert.doesNotMatch(migration, /CHECK\("__new_/u);
  assert.match(journal, /0008_chief_liz_osborn/u);
  assert.match(snapshot, /inspection_requests_source_allowed/u);
});
