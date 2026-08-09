import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("la migration prépare les quatre groupes Facebook et garde X séparé", async () => {
  const database = new DatabaseSync(":memory:");
  const migrationsRoot = new URL("../drizzle/", import.meta.url);
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    const names = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
    for (const name of names) database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));
    assert.equal(database.prepare("SELECT count(*) AS count FROM social_sources WHERE platform='facebook' AND enabled=1").get().count, 4);
    assert.equal(database.prepare("SELECT status FROM social_sources WHERE id='x:dealabs'").get().status, "awaiting_access");
    assert.equal(database.prepare("SELECT social_notifications_enabled FROM user_preferences LIMIT 1").get(), undefined);
    database.exec("INSERT INTO user_preferences(owner_id) VALUES('device:test');");
    assert.equal(database.prepare("SELECT social_notifications_enabled AS enabled FROM user_preferences WHERE owner_id='device:test'").get().enabled, 0);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("l’interface sépare clairement publications sociales et alertes de prix", async () => {
  const [interfaceSource, serviceWorker, actor] = await Promise.all([
    readFile(new URL("../app/components/price-radar-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../services/collector/src/actor.ts", import.meta.url), "utf8"),
  ]);
  assert.match(interfaceSource, /Publication non vérifiée par PrixRadar/u);
  assert.match(interfaceSource, /0<\/strong><span>jeton Keepa utilisé/u);
  assert.match(interfaceSource, /label: "Flux"/u);
  assert.match(serviceWorker, /payload\.tier === "social"/u);
  assert.match(actor, /collectFacebookSocialSources/u);
  assert.match(actor, /sendSocialPublicationPush/u);
});
