import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationsRoot = new URL("../drizzle/", import.meta.url);

test("migration 0010 audits and deduplicates protection push deliveries", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const previous = (await readdir(migrationsRoot)).filter((name) => /^(?:000\d)_.+\.sql$/u.test(name)).sort();
    for (const name of previous) database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));
    database.exec(await readFile(new URL("0010_sleepy_blue_marvel.sql", migrationsRoot), "utf8"));
    database.exec(`
      PRAGMA foreign_keys=ON;
      INSERT INTO alerts(id,source,source_mode,merchant,market,product_id,title,url,currency,price_cents,usual_price_cents,discount_percent,score,confidence,status,observed_at)
      VALUES('shield-alert','darty','live','Darty','FR','shield','Produit','https://www.darty.com/nav/achat/shield.html','EUR',70000,100000,30,90,'very_likely','active','2026-08-01T00:00:00.000Z');
      INSERT INTO purchases(id,owner_id,alert_id,source,market,product_id,title,url,currency,paid_total_cents,reference_price_cents,realized_savings_cents,best_price_cents,potential_recovery_cents,status,purchased_at,protection_ends_at,next_check_at)
      VALUES('purchase:00000000-0000-4000-8000-000000000010','owner','shield-alert','darty','FR','shield','Produit','https://www.darty.com/nav/achat/shield.html','EUR',70000,100000,30000,62000,8000,'action_available','2026-08-01T00:00:00.000Z','2026-08-15T00:00:00.000Z','2026-08-01T00:00:00.000Z');
      INSERT INTO push_subscriptions(owner_id,endpoint,p256dh,auth) VALUES('owner','https://push.example/sub','key','auth');
      INSERT INTO protection_notifications(purchase_id,subscription_id,owner_id,price_cents,dedupe_key)
      VALUES('purchase:00000000-0000-4000-8000-000000000010',1,'owner',62000,'purchase:1:62000');
    `);
    assert.equal(database.prepare("SELECT count(*) AS count FROM protection_notifications").get().count, 1);
    assert.throws(() => database.exec(`INSERT INTO protection_notifications(purchase_id,subscription_id,owner_id,price_cents,dedupe_key) VALUES('purchase:00000000-0000-4000-8000-000000000010',1,'owner',62000,'purchase:1:62000')`), /UNIQUE constraint failed/u);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
