import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("le bail D1 regroupe les déclenchements sociaux concurrents", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(await readFile(new URL("../drizzle/0022_social_dispatch_leases.sql", import.meta.url), "utf8"));
    const claim = database.prepare(`
      INSERT INTO social_dispatch_leases(id, attempt_id, lease_expires_at, updated_at)
      VALUES ('facebook-push', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        attempt_id = excluded.attempt_id,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = excluded.updated_at
      WHERE social_dispatch_leases.lease_expires_at <= excluded.updated_at
      RETURNING attempt_id
    `);
    assert.equal(claim.get("attempt-a", "2026-08-13T08:01:00.000Z", "2026-08-13T08:00:00.000Z")?.attempt_id, "attempt-a");
    assert.equal(claim.get("attempt-b", "2026-08-13T08:01:30.000Z", "2026-08-13T08:00:30.000Z"), undefined);
    assert.equal(claim.get("attempt-c", "2026-08-13T08:02:01.000Z", "2026-08-13T08:01:01.000Z")?.attempt_id, "attempt-c");
  } finally {
    database.close();
  }
});

test("l’ingestion ne relance Apify que pour de nouvelles publications et libère un démarrage refusé", async () => {
  const route = await readFile(new URL("../app/api/social/ingest/route.ts", import.meta.url), "utf8");
  assert.match(route, /startSocialDispatch\(database, newPublications\)/u);
  assert.match(route, /setWhere: lte\(socialDispatchLeases\.leaseExpiresAt, attemptedAt\)/u);
  assert.match(route, /database\.delete\(socialDispatchLeases\)/u);
});

test("le flux privé est paginé et non mis en cache", async () => {
  const [route, sink] = await Promise.all([
    readFile(new URL("../app/api/social/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/collector/src/sink.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /authenticateSocialCollector\(request\)/u);
  assert.match(route, /privateRequest \? "no-store"/u);
  assert.match(route, /\.offset\(offset\)/u);
  assert.match(sink, /offset \+= pageSize/u);
});
