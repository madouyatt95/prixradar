import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("la couverture Amazon automatique se concentre sur High-Tech et maison", async () => {
  const database = new DatabaseSync(":memory:");
  const migrationsRoot = new URL("../drizzle/", import.meta.url);
  try {
    database.exec("PRAGMA foreign_keys=ON;");
    const names = (await readdir(migrationsRoot)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
    for (const name of names) database.exec(await readFile(new URL(name, migrationsRoot), "utf8"));

    const active = database
      .prepare("SELECT id, daily_token_budget AS budget FROM discovery_segments WHERE enabled=1 ORDER BY priority DESC")
      .all()
      .map((row) => ({ id: row.id, budget: row.budget }));
    assert.deepEqual(active, [
      { id: "amazon-fr-tech", budget: 576 },
      { id: "amazon-fr-maison", budget: 384 },
    ]);
    assert.equal(database.prepare("SELECT count(*) AS count FROM discovery_segments WHERE enabled=0 AND id IN ('amazon-fr-bricolage','amazon-fr-sport-beaute')").get().count, 2);
  } finally {
    database.close();
  }
});

test("l’interface explique où trouver les résultats JD Sports et montre aussi zéro", async () => {
  const source = await readFile(new URL("../app/components/price-radar-app.tsx", import.meta.url), "utf8");
  assert.match(source, /mention « À vérifier »/u);
  assert.match(source, /sans attendre les preuves exigées pour une alerte fiable/u);
  assert.match(source, /runtime\.productsSeen !== undefined/u);
  assert.match(source, /Dernier passage réussi/u);
});

test("une offre JD Sports repérée une fois reste visible et notifiable dès le score 35", async () => {
  const [ingest, alerts] = await Promise.all([
    readFile(new URL("../app/api/ingest/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/alerts/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(ingest, /const JD_LISTING_WATCH_MIN_SCORE = 35/u);
  assert.match(ingest, /categoryListingWatchEligible[\s\S]*evaluation\.score >= JD_LISTING_WATCH_MIN_SCORE/u);
  const listingRule = ingest.slice(
    ingest.indexOf("const categoryListingWatchEligible"),
    ingest.indexOf("const broadWatchEligible"),
  );
  assert.doesNotMatch(listingRule, /evaluation\.checks\.secondVerification/u);
  assert.match(alerts, /view === "single_check" \? 0 : 35/u);
  assert.match(alerts, /item\.source === "jd_sports"/u);
});
