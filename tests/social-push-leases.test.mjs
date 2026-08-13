import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la migration ajoute un bail et un identifiant de tentative aux notifications sociales", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE social_notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        publication_id TEXT NOT NULL,
        subscription_id INTEGER NOT NULL,
        owner_id TEXT NOT NULL,
        status TEXT DEFAULT 'reserved' NOT NULL,
        dedupe_key TEXT NOT NULL,
        attempted_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        sent_at TEXT,
        error_code TEXT
      );
    `);
    const migration = await readFile(new URL("../drizzle/0021_social_push_leases.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      database.exec(statement);
    }

    const columns = database.prepare("PRAGMA table_info(social_notification_deliveries)").all();
    assert.equal(columns.some((column) => column.name === "attempt_id" && column.notnull === 1), true);
    assert.equal(columns.some((column) => column.name === "lease_expires_at"), true);
    const indexes = database.prepare("PRAGMA index_list(social_notification_deliveries)").all();
    assert.equal(indexes.some((index) => index.name === "social_notification_deliveries_status_lease_idx"), true);

    database.prepare(`
      INSERT INTO social_notification_deliveries(publication_id, subscription_id, owner_id, dedupe_key)
      VALUES (?, ?, ?, ?)
    `).run("facebook:1:post", 1, "device:test", "dedupe");
    const migrated = database.prepare(
      "SELECT attempt_id AS attemptId, lease_expires_at AS leaseExpiresAt FROM social_notification_deliveries",
    ).get();
    assert.equal(migrated.attemptId, "");
    assert.equal(migrated.leaseExpiresAt, null);
  } finally {
    database.close();
  }
});

test("la route sociale récupère les baux expirés et refuse les confirmations d’une ancienne tentative", async () => {
  const [route, schema] = await Promise.all([
    readFile(new URL("../app/api/push/social/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /SOCIAL_DELIVERY_LEASE_MS = 15 \* 60_000/u);
  assert.match(route, /attemptId: crypto\.randomUUID\(\)/u);
  assert.match(route, /isNull\(socialNotificationDeliveries\.leaseExpiresAt\)/u);
  assert.match(route, /lte\(socialNotificationDeliveries\.leaseExpiresAt, retryLease\.attemptedAt\)/u);
  assert.match(route, /attemptId: reservation\.attemptId/u);
  assert.match(route, /eq\(socialNotificationDeliveries\.attemptId, value\.attemptId\)/u);
  assert.match(route, /returning\(\{ subscriptionId: socialNotificationDeliveries\.subscriptionId \}\)/u);
  assert.match(schema, /attemptId: text\("attempt_id"\)\.notNull\(\)\.default\(""\)/u);
  assert.match(schema, /leaseExpiresAt: text\("lease_expires_at"\)/u);
});
