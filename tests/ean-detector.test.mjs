import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migrationsRoot = new URL("../drizzle/", import.meta.url);

test("le scan EAN déclenche une détection persistante et une recherche Keepa par code", async () => {
  const [route, plan, actor, keepa, interfaceSource, targets, radar] = await Promise.all([
    source("../app/api/ean/route.ts"),
    source("../app/api/source-plan/route.ts"),
    source("../services/collector/src/actor.ts"),
    source("../services/collector/src/keepa.ts"),
    source("../app/components/price-radar-app.tsx"),
    source("../app/api/push/targets/route.ts"),
    source("../lib/radar-intent.ts"),
  ]);
  assert.match(route, /normalizeGtin/u);
  assert.match(route, /database\.insert\(eanScanRequests\)/u);
  assert.match(route, /database\.insert\(radarRules\)/u);
  assert.match(route, /gtins: \[gtin\]/u);
  assert.match(route, /restoredRule/u);
  assert.match(plan, /eanScans/u);
  assert.match(plan, /status: "processing"/u);
  assert.match(actor, /productsByCodes\(market, \[scan\.gtin\]\)/u);
  assert.match(actor, /postEanScanResult/u);
  assert.match(keepa, /code: unique\.join\(","\)/u);
  assert.match(interfaceSource, /Détecteur autonome/u);
  assert.match(interfaceSource, /Surveillance automatique lancée/u);
  assert.match(targets, /gtin/u);
  assert.match(radar, /intent\.gtins/u);
});

test("la migration 0011 indexe et déduplique les surveillances EAN par appareil", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const names = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
    for (const name of names) database.exec(await source(`../drizzle/${name}`));
    database.exec(`
      INSERT INTO ean_scan_requests(id, owner_id, gtin) VALUES('ean:00000000-0000-4000-8000-000000000011','owner','4006381333931');
    `);
    assert.throws(() => database.exec(`
      INSERT INTO ean_scan_requests(id, owner_id, gtin) VALUES('ean:00000000-0000-4000-8000-000000000012','owner','4006381333931');
    `), /UNIQUE constraint failed/u);
    const indexes = database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND tbl_name='ean_scan_requests'").all().map((row) => row.name);
    assert.ok(indexes.includes("ean_scan_status_due_idx"));
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
