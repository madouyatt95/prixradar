import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("la migration active le relais email des deux groupes prioritaires", async () => {
  const database = new DatabaseSync(":memory:");
  const migrationsRoot = new URL("../drizzle/", import.meta.url);
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    const names = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
    for (const name of names) database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));
    assert.equal(database.prepare("SELECT count(*) AS count FROM social_sources WHERE platform='facebook' AND enabled=1 AND status='ready'").get().count, 2);
    assert.equal(database.prepare("SELECT count(*) AS count FROM social_sources WHERE platform='facebook' AND enabled=0 AND status='ready'").get().count, 2);
    assert.equal(database.prepare("SELECT count(*) AS count FROM social_sources WHERE platform='facebook' AND cadence_minutes=5").get().count, 4);
    assert.equal(database.prepare("SELECT enabled FROM social_sources WHERE id='facebook:848306336465354'").get().enabled, 1);
    assert.equal(database.prepare("SELECT enabled FROM social_sources WHERE id='facebook:584379244259839'").get().enabled, 1);
    assert.equal(database.prepare("SELECT status FROM social_sources WHERE id='x:dealabs'").get().status, "awaiting_access");
    assert.equal(database.prepare("SELECT count(*) AS count FROM social_collection_runs").get().count, 0);
    assert.equal(database.prepare("SELECT social_notifications_enabled FROM user_preferences LIMIT 1").get(), undefined);
    database.exec("INSERT INTO user_preferences(owner_id) VALUES('device:test');");
    assert.equal(database.prepare("SELECT social_notifications_enabled AS enabled FROM user_preferences WHERE owner_id='device:test'").get().enabled, 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("l’interface sépare clairement publications sociales et alertes de prix", async () => {
  const [interfaceSource, serviceWorker, actor, ingestRoute, gmailBridge] = await Promise.all([
    readFile(new URL("../app/components/price-radar-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../services/collector/src/actor.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/social/ingest/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../integrations/facebook-gmail-bridge/Code.gs", import.meta.url), "utf8"),
  ]);
  assert.match(interfaceSource, /Publication non vérifiée par PrixRadar/u);
  assert.match(interfaceSource, /plage de réception quotidienne/u);
  assert.match(interfaceSource, /label: "Flux"/u);
  assert.match(interfaceSource, /relue chaque minute entre 7 h 30 et 15 h/ui);
  assert.match(serviceWorker, /payload\.tier === "social"/u);
  assert.match(actor, /collectFacebookSocialSources/u);
  assert.doesNotMatch(actor, /collectOfficialFacebookSources/u);
  assert.match(actor, /requestSocialCollectionPlan/u);
  assert.match(actor, /sendSocialPublicationPush/u);
  assert.match(ingestRoute, /SOCIAL_DISPATCH_ACTOR_ID/u);
  assert.match(ingestRoute, /Authorization: `Bearer \$\{token\}`/u);
  assert.doesNotMatch(gmailBridge, /APIFY_TOKEN/u);
});
