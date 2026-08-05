import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsRoot = new URL("../drizzle/", import.meta.url);

test("migration 0012 preserves every alert relation and focuses discovery on France", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    const previous = (await readdir(migrationsRoot)).filter((name) => /^(?:000\d|001[01])_.+\.sql$/u.test(name)).sort();
    for (const name of previous) database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));
    database.exec(`
      INSERT INTO alerts(id,source,source_mode,merchant,market,product_id,title,url,currency,price_cents,usual_price_cents,discount_percent,score,confidence,status,observed_at)
      VALUES('alert-0012','darty','live','Darty','FR','existing','Produit conservé','https://www.darty.com/nav/achat/existing.html','EUR',10000,20000,50,90,'very_likely','active','2026-08-05T00:00:00.000Z');
      INSERT INTO price_observations(alert_id,price_cents,shipping_cents,total_cents,available,observed_at,raw_hash)
      VALUES('alert-0012',10000,0,10000,1,'2026-08-05T00:00:00.000Z','hash-0012');
      INSERT INTO alert_intelligence(alert_id,variant_fingerprint,price_index_cents) VALUES('alert-0012','variant-0012',10000);
      INSERT INTO alert_feedback(alert_id,owner_id,verdict) VALUES('alert-0012','owner-0012','useful');
      INSERT INTO recheck_requests(id,alert_id,owner_id,source,market,url) VALUES('recheck-0012','alert-0012','owner-0012','darty','FR','https://www.darty.com/nav/achat/existing.html');
      INSERT INTO radar_rules(id,owner_id,name,query,intent_json) VALUES('radar-0012','owner-0012','Radar','produit','{}');
      INSERT INTO mission_items(id,mission_id,owner_id,label,query,intent_json,selected_alert_id) VALUES('mission-item-0012','radar-0012','owner-0012','Produit','produit','{}','alert-0012');
      INSERT INTO purchases(id,owner_id,alert_id,source,market,product_id,title,url,currency,paid_total_cents,reference_price_cents,purchased_at,protection_ends_at,next_check_at)
      VALUES('purchase-0012','owner-0012','alert-0012','darty','FR','existing','Produit conservé','https://www.darty.com/nav/achat/existing.html','EUR',10000,20000,'2026-08-05T00:00:00.000Z','2026-08-19T00:00:00.000Z','2026-08-06T00:00:00.000Z');
      INSERT INTO ean_scan_requests(id,owner_id,gtin,matched_alert_id) VALUES('ean:00000000-0000-4000-8000-000000000012','owner-0012','5904204753289','alert-0012');
      INSERT INTO discovery_segments(id,market,label,daily_token_budget) VALUES('segment-fr-0012','FR','France',20),('segment-de-0012','DE','Allemagne',20);
    `);

    const migration = await readFile(new URL("0012_jittery_molecule_man.sql", migrationsRoot), "utf8");
    database.exec(`BEGIN;\n${migration}\nCOMMIT;`);

    assert.equal(database.prepare("SELECT count(*) AS count FROM alerts WHERE id='alert-0012'").get().count, 1);
    for (const table of ["price_observations", "alert_intelligence", "alert_feedback", "recheck_requests"]) {
      assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table} WHERE alert_id='alert-0012'`).get().count, 1, table);
    }
    assert.equal(database.prepare("SELECT selected_alert_id FROM mission_items WHERE id='mission-item-0012'").get().selected_alert_id, "alert-0012");
    assert.equal(database.prepare("SELECT alert_id FROM purchases WHERE id='purchase-0012'").get().alert_id, "alert-0012");
    assert.equal(database.prepare("SELECT matched_alert_id FROM ean_scan_requests WHERE id='ean:00000000-0000-4000-8000-000000000012'").get().matched_alert_id, "alert-0012");
    assert.equal(database.prepare("SELECT daily_token_budget FROM discovery_segments WHERE id='segment-fr-0012'").get().daily_token_budget, 100);
    assert.equal(database.prepare("SELECT enabled FROM discovery_segments WHERE id='segment-de-0012'").get().enabled, 0);
    assert.equal(database.prepare("SELECT count(*) AS count FROM source_configurations WHERE source='jd_sports' AND enabled=1").get().count, 3);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
