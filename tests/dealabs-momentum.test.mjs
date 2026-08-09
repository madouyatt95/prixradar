import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { isDealabsNightPause } from "../lib/dealabs-schedule.ts";

test("Dealabs est suspendu de 1 h à 7 h, heure de Paris, été comme hiver", () => {
  assert.equal(isDealabsNightPause(new Date("2026-01-09T23:59:00Z")), false);
  assert.equal(isDealabsNightPause(new Date("2026-01-10T00:00:00Z")), true);
  assert.equal(isDealabsNightPause(new Date("2026-01-10T05:59:00Z")), true);
  assert.equal(isDealabsNightPause(new Date("2026-01-10T06:00:00Z")), false);

  assert.equal(isDealabsNightPause(new Date("2026-08-10T22:59:00Z")), false);
  assert.equal(isDealabsNightPause(new Date("2026-08-10T23:00:00Z")), true);
  assert.equal(isDealabsNightPause(new Date("2026-08-11T04:59:00Z")), true);
  assert.equal(isDealabsNightPause(new Date("2026-08-11T05:00:00Z")), false);
});

test("le parseur Dealabs borne le flux et sépare température, prix et URL", async () => {
  const source = await readFile(new URL("../lib/dealabs.ts", import.meta.url), "utf8");
  assert.match(source, /MAX_FEED_BYTES = 768 \* 1024/u);
  assert.match(source, /MAX_FEED_ITEMS = 40/u);
  assert.match(source, /PrixRadar\/0\.11/u);
  assert.match(source, /titleMatch = \/\^\(-\?\\d\+/u);
  assert.match(source, /parseFrenchPrice/u);
  assert.match(source, /parseCoverageProductUrl/u);
  assert.match(source, /AbortSignal\.timeout\(12_000\)/u);
  assert.doesNotMatch(source, /captcha|proxy|stealth/iu);
});

test("le canal e-mail refuse les expéditeurs non autorisés", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /trustedDealabsSender/u);
  assert.match(worker, /message\.setReject/u);
  assert.match(worker, /message\.rawSize > 512 \* 1024/u);
});

test("la migration Dealabs conserve les signaux et leurs relevés liés", async () => {
  const database = new DatabaseSync(":memory:");
  const migrationsRoot = new URL("../drizzle/", import.meta.url);
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    const names = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
    for (const name of names) database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));
    database.exec(`
      INSERT INTO community_signals(id,external_id,title,merchant,deal_url,temperature,published_at)
      VALUES('dealabs:3390023','3390023','Carte graphique','Amazon','https://www.dealabs.com/bons-plans/test-3390023',152,'2026-08-09T16:19:36.000Z');
      INSERT INTO community_signal_observations(signal_id,temperature,observed_at)
      VALUES('dealabs:3390023',152,'2026-08-09T16:20:00.000Z');
    `);
    assert.equal(database.prepare("SELECT temperature FROM community_signals WHERE id='dealabs:3390023'").get().temperature, 152);
    assert.equal(database.prepare("SELECT count(*) AS count FROM community_signal_observations").get().count, 1);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});

test("le Worker planifie Dealabs et l'interface sépare communauté et confirmation", async () => {
  const [worker, interfaceSource, route] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/price-radar-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dealabs/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(worker, /syncDealabsTrend/u);
  assert.match(worker, /isDealabsNightPause\(scheduledAt\)/u);
  assert.match(worker, /async email\(/u);
  assert.match(interfaceSource, /Ça chauffe maintenant/u);
  assert.match(interfaceSource, /Signal communautaire/u);
  assert.match(interfaceSource, /Confirmé par PrixRadar/u);
  assert.match(route, /cadenceMinutes: 5/u);
});
