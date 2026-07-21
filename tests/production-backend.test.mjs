import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("publishes only live, fully verified anomalies", async () => {
  const [alertsRoute, ingestRoute, anomaly, schema] = await Promise.all([
    source("../app/api/alerts/route.ts"),
    source("../app/api/ingest/route.ts"),
    source("../lib/anomaly.ts"),
    source("../db/schema.ts"),
  ]);

  assert.match(alertsRoute, /eq\(alerts\.sourceMode, "live"\)/);
  assert.match(alertsRoute, /isNotNull\(alerts\.shippingCents\)/);
  assert.match(alertsRoute, /notificationEligible/);
  assert.match(ingestRoute, /INGEST_SECRET/);
  assert.match(ingestRoute, /IDEMPOTENCY_CONFLICT/);
  assert.match(
    ingestRoute,
    /totalCents:\s*shadowCart\.finalTotalCents/,
  );
  assert.match(anomaly, /candidate\.sourceMode === "live"/);
  assert.match(anomaly, /candidate\.verificationCount >= 2/);
  assert.match(anomaly, /shipping_unknown/);
  assert.doesNotMatch(
    schema,
    /shippingCents:\s*integer\("shipping_cents"\)\.notNull\(\)\.default\(0\)/,
  );
});

test("keeps push preferences durable and private APIs out of caches", async () => {
  const [pushRoute, targetRoute, serverAuth, deliveriesRoute, preferencesRoute, serviceWorker] = await Promise.all([
    source("../app/api/push/route.ts"),
    source("../app/api/push/targets/route.ts"),
    source("../app/api/push/server-auth.ts"),
    source("../app/api/push/deliveries/route.ts"),
    source("../app/api/preferences/route.ts"),
    source("../public/sw.js"),
  ]);

  assert.match(pushRoute, /pushSubscriptions/);
  assert.match(pushRoute, /VAPID_PUBLIC_KEY|vapidPublicKey/);
  assert.match(serverAuth, /PUSH_DELIVERY_SECRET/);
  assert.doesNotMatch(serverAuth, /INGEST_SECRET/);
  assert.match(targetRoute, /lte\(userPreferences\.minScore, score\)/);
  assert.doesNotMatch(targetRoute, /ownerId:/);
  assert.match(deliveriesRoute, /dedupeKey/);
  assert.match(preferencesRoute, /userPreferences/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification/);
});

test("ships the incremental D1 schema for collection and notification audit", async () => {
  const migration = await source("../drizzle/0001_mushy_magma.sql");

  for (const table of [
    "alerts",
    "price_observations",
    "source_statuses",
    "ingest_events",
    "keepa_cache",
    "keepa_usage",
    "push_subscriptions",
    "user_preferences",
    "notification_deliveries",
  ]) {
    assert.ok(migration.includes(`CREATE TABLE \`${table}\``));
  }
  assert.match(migration, /`shipping_cents` integer,/);
  assert.match(migration, /`total_cents` integer,/);
});

test("ships canonical matching, local delivery rules and automatic source circuits", async () => {
  const [schema, identity, preferences, sourcePlan, admin, adminView, migration] = await Promise.all([
    source("../db/schema.ts"),
    source("../lib/product-identity.ts"),
    source("../app/api/preferences/route.ts"),
    source("../app/api/source-plan/route.ts"),
    source("../lib/admin.ts"),
    source("../app/components/admin-view.tsx"),
    source("../drizzle/0003_kind_mauler.sql"),
  ]);

  assert.match(schema, /canonicalProducts/);
  assert.match(schema, /merchantProducts/);
  assert.match(schema, /discoverySegments/);
  assert.match(schema, /circuitState/);
  assert.match(identity, /normalizeGtin/);
  assert.match(identity, /brand_model/);
  assert.match(preferences, /requireLocationMatch/);
  assert.match(sourcePlan, /probeOnly/);
  assert.match(sourcePlan, /dailyTokenBudget/);
  assert.match(admin, /cf-access-jwt-assertion/);
  assert.match(admin, /crypto\.subtle\.verify/);
  assert.doesNotMatch(adminView, /signin-with-chatgpt/i);
  assert.match(migration, /CREATE TABLE `canonical_products`/);
  assert.match(migration, /CREATE TABLE `discovery_segments`/);
  assert.match(migration, /SELECT[\s\S]*'closed', 0, 0, NULL, NULL, NULL, 500/);
});

test("ships durable game-changer radars, proof, rechecks and three notification speeds", async () => {
  const [schema, migration, app, radars, recheck, digests, sourcePlan] = await Promise.all([
    source("../db/schema.ts"),
    source("../drizzle/0004_grey_luckman.sql"),
    source("../app/components/price-radar-app.tsx"),
    source("../app/api/radars/route.ts"),
    source("../app/api/recheck/route.ts"),
    source("../app/api/push/digests/route.ts"),
    source("../app/api/source-plan/route.ts"),
  ]);
  assert.match(schema, /radarRules/);
  assert.match(schema, /recheckRequests/);
  assert.match(schema, /buyNowScore/);
  assert.match(schema, /notificationSpeed/);
  assert.match(migration, /CREATE TABLE `radar_rules`/);
  assert.match(migration, /CREATE TABLE `recheck_requests`/);
  assert.match(migration, /SELECT[\s\S]*0, '\{\}', "confidence"/);
  assert.doesNotMatch(migration, /SELECT[^;]*"score", "buy_now_score"/);
  assert.match(app, /Scanner un EAN/);
  assert.match(app, /Passeport de preuve/);
  assert.match(app, /Contrôle autonome/);
  assert.match(app, /Panier fantôme/);
  assert.match(radars, /parseRadarIntent/);
  assert.match(recheck, /status: "pending"/);
  assert.match(digests, /notificationSpeed, "digest"/);
  assert.match(sourcePlan, /optimizeCoverageBudgets/);
});

test("ships autonomous cart, variant, index, sharing and sentinel controls", async () => {
  const [schema, autonomy, manifest, inspections, frontier, sourcePlan, app] = await Promise.all([
    source("../db/schema.ts"), source("../lib/autonomy.ts"), source("../app/manifest.ts"),
    source("../app/api/inspections/route.ts"), source("../app/api/frontier/route.ts"),
    source("../app/api/source-plan/route.ts"), source("../app/components/price-radar-app.tsx"),
  ]);
  assert.match(schema, /alertIntelligence/);
  assert.match(schema, /inspectionRequests/);
  assert.match(schema, /sentinelFrontier/);
  assert.match(autonomy, /buildVariantFingerprint/);
  assert.match(autonomy, /evaluateShadowCart/);
  assert.match(autonomy, /buildPriceRadarIndex/);
  assert.match(autonomy, /predictOpportunityLifetime/);
  assert.match(manifest, /share_target/);
  assert.match(inspections, /status: "pending"/);
  assert.match(frontier, /sentinelPriority/);
  assert.match(sourcePlan, /frontierItems/);
  assert.doesNotMatch(app, /idealo|Dealabs/);
});

test("keeps the mobile header clear of the iPhone safe area", async () => {
  const [layout, styles] = await Promise.all([
    source("../app/layout.tsx"),
    source("../app/globals.css"),
  ]);

  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(styles, /--safe-top:\s*env\(safe-area-inset-top, 0px\)/);
  assert.match(styles, /min-height:\s*calc\(64px \+ var\(--safe-top\)\)/);
  assert.match(styles, /padding:\s*calc\(10px \+ var\(--safe-top\)\)/);
  assert.match(await source("../public/sw.js"), /prixradar-shell-v5/);
});
