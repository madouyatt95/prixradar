import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationsRoot = new URL("../drizzle/", import.meta.url);

async function migrationFilesBefore0008() {
  return (await readdir(migrationsRoot))
    .filter((name) => /^000[0-7]_.+\.sql$/u.test(name))
    .sort();
}

test("migration 0008 preserves every alerts child with foreign keys enabled", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    for (const name of await migrationFilesBefore0008()) {
      database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));
    }
    database.exec(`
      PRAGMA foreign_keys=ON;
      INSERT INTO alerts(id,source,source_mode,merchant,market,product_id,title,url,currency,price_cents,usual_price_cents,discount_percent,score,confidence,status,observed_at)
      VALUES('migration-alert','darty','live','Darty','FR','existing','Produit existant','https://www.darty.com/nav/achat/existing.html','EUR',10000,20000,50,90,'very_likely','active','2026-07-22T00:00:00.000Z');
      INSERT INTO price_observations(alert_id,price_cents,shipping_cents,total_cents,available,observed_at,raw_hash)
      VALUES('migration-alert',10000,0,10000,1,'2026-07-22T00:00:00.000Z','hash-one');
      INSERT INTO alert_intelligence(alert_id,variant_fingerprint,price_index_cents)
      VALUES('migration-alert','variant-one',10000);
      INSERT INTO alert_feedback(alert_id,owner_id,verdict)
      VALUES('migration-alert','owner','useful');
      INSERT INTO recheck_requests(id,alert_id,owner_id,source,market,url)
      VALUES('recheck-one','migration-alert','owner','darty','FR','https://www.darty.com/nav/achat/existing.html');
      INSERT INTO inspection_requests(id,owner_id,url,source,market)
      VALUES('inspection-one','owner','https://www.boulanger.com/ref/existing','boulanger','FR');
      INSERT INTO merchant_products(id,source,market,external_id,title,url,match_method,match_score,last_seen_at)
      VALUES('product-one','cdiscount','FR','existing','Produit existant','https://www.cdiscount.com/high-tech/example/f-1-existing.html','identity',80,'2026-07-22T00:00:00.000Z');
    `);

    const migration = await readFile(new URL("0008_chief_liz_osborn.sql", migrationsRoot), "utf8");
    database.exec(`BEGIN;\n${migration}\nCOMMIT;`);

    const counts = database.prepare(`
      SELECT
        (SELECT count(*) FROM alerts) AS alerts,
        (SELECT count(*) FROM price_observations) AS observations,
        (SELECT count(*) FROM alert_intelligence) AS intelligence,
        (SELECT count(*) FROM alert_feedback) AS feedback,
        (SELECT count(*) FROM recheck_requests) AS rechecks,
        (SELECT count(*) FROM inspection_requests) AS inspections,
        (SELECT count(*) FROM merchant_products) AS products
    `).get();
    assert.deepEqual({ ...counts }, {
      alerts: 1,
      observations: 1,
      intelligence: 1,
      feedback: 1,
      rechecks: 1,
      inspections: 1,
      products: 1,
    });
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);

    database.exec(`
      INSERT INTO alerts(id,source,source_mode,merchant,market,product_id,title,url,currency,price_cents,usual_price_cents,discount_percent,score,confidence,status,observed_at)
      VALUES('new-fnac','fnac','live','Fnac','FR','a21851909','Produit Fnac','https://www.fnac.com/a21851909/test','EUR',10000,20000,50,90,'very_likely','active','2026-07-22T00:00:00.000Z');
      INSERT INTO price_observations(alert_id,price_cents,shipping_cents,total_cents,available,observed_at,raw_hash)
      VALUES('new-fnac',10000,0,10000,1,'2026-07-22T00:00:00.000Z','hash-two');
      INSERT INTO alert_feedback(alert_id,owner_id,verdict)
      VALUES('new-fnac','owner-two','useful');
    `);
    assert.equal(database.prepare("SELECT max(id) AS id FROM price_observations").get().id, 2);
    assert.equal(database.prepare("SELECT max(id) AS id FROM alert_feedback").get().id, 2);
    assert.throws(() => database.exec(`
      INSERT INTO alerts(id,source,source_mode,merchant,market,product_id,title,url,currency,price_cents,usual_price_cents,discount_percent,score,confidence,status,observed_at)
      VALUES('unsupported','e_leclerc','live','E.Leclerc','FR','x','Produit','https://www.e.leclerc/x','EUR',100,200,50,90,'likely','active','2026-07-22T00:00:00.000Z');
    `), /CHECK constraint failed/u);
  } finally {
    database.close();
  }
});
