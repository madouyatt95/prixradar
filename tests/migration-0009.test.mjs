import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationsRoot = new URL("../drizzle/", import.meta.url);

test("migration 0009 preserves radars and creates the purchase protection ledger", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const previous = (await readdir(migrationsRoot)).filter((name) => /^000[0-8]_.+\.sql$/u.test(name)).sort();
    for (const name of previous) database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));
    database.exec(`
      PRAGMA foreign_keys=ON;
      INSERT INTO radar_rules(id, owner_id, name, query, intent_json)
      VALUES('radar:00000000-0000-4000-8000-000000000001','owner','OLED','OLED sous 800 euros','{}');
      INSERT INTO alerts(id,source,source_mode,merchant,market,product_id,title,url,currency,price_cents,usual_price_cents,discount_percent,score,confidence,status,observed_at)
      VALUES('protected-alert','darty','live','Darty','FR','oled','OLED','https://www.darty.com/nav/achat/oled.html','EUR',70000,100000,30,90,'very_likely','active','2026-08-01T00:00:00.000Z');
    `);
    database.exec(await readFile(new URL("0009_lying_union_jack.sql", migrationsRoot), "utf8"));

    const radar = database.prepare("SELECT kind,status,allow_alternatives FROM radar_rules WHERE owner_id='owner'").get();
    assert.deepEqual({ ...radar }, { kind: "single", status: "active", allow_alternatives: 1 });
    database.exec(`
      INSERT INTO mission_items(id,mission_id,owner_id,label,query,intent_json)
      VALUES('mission-item:00000000-0000-4000-8000-000000000001','radar:00000000-0000-4000-8000-000000000001','owner','OLED','OLED sous 800 euros','{}');
      INSERT INTO purchases(id,owner_id,alert_id,mission_id,mission_item_id,source,market,product_id,title,url,currency,paid_total_cents,reference_price_cents,realized_savings_cents,purchased_at,protection_ends_at,next_check_at)
      VALUES('purchase:00000000-0000-4000-8000-000000000001','owner','protected-alert','radar:00000000-0000-4000-8000-000000000001','mission-item:00000000-0000-4000-8000-000000000001','darty','FR','oled','OLED','https://www.darty.com/nav/achat/oled.html','EUR',70000,100000,30000,'2026-08-01T00:00:00.000Z','2026-08-15T00:00:00.000Z','2026-08-01T00:00:00.000Z');
      INSERT INTO purchase_events(purchase_id,event_type,price_cents)
      VALUES('purchase:00000000-0000-4000-8000-000000000001','purchased',70000);
    `);
    assert.equal(database.prepare("SELECT realized_savings_cents AS savings FROM purchases").get().savings, 30000);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(() => database.exec("UPDATE radar_rules SET kind='unknown'"), /CHECK constraint failed/u);
  } finally {
    database.close();
  }
});
