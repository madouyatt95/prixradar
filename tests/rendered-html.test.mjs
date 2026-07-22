import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("ships the complete PrixRadar application shell", async () => {
  const [page, layout, application] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/price-radar-app.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(page, /PrixRadar — Les vraies anomalies de prix, vérifiées/);
  assert.match(page, /<PriceRadarApp \/>/);
  assert.match(layout, /<html lang="fr">/);
  assert.match(application, /Voici comment seront classées vos alertes/);
  assert.match(application, /Prix illustratifs, aucun achat réel/);
  assert.match(application, /Amazon · Keepa/);
  assert.match(application, /Navigation principale/);
  assert.doesNotMatch(
    `${page}${layout}${application}`,
    /codex-preview|Your site is taking shape|Building your site|react-loading-skeleton/i,
  );
});

test("shows the six additional French retailers without claiming they are live", async () => {
  const [application, admin] = await Promise.all([
    readFile(new URL("../app/components/price-radar-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/admin-view.tsx", import.meta.url), "utf8"),
  ]);
  for (const merchant of ["Fnac", "Carrefour", "Leroy Merlin", "Castorama", "Conforama", "Rue du Commerce"]) {
    assert.match(application, new RegExp(merchant));
    assert.match(admin, new RegExp(merchant));
  }
  assert.match(application, /Connecteur prêt · accès requis/);
  assert.match(application, /premier rapport sain/);
  assert.match(application, /sources: preferredSources/);
  assert.match(admin, /statut LIVE exige ensuite un rapport sain récent/);
  assert.doesNotMatch(application, /sur 4 enseignes \+ Amazon/);
});

test("ships an installable PWA without caching private APIs", async () => {
  const [manifest, serviceWorker, layout, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(manifest, /display:\s*"standalone"/);
  assert.match(manifest, /start_url:\s*"\/"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-512\.png/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /og-v3\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1, "DB");
  assert.equal(hostingConfig.r2, null);
  assert.match(hostingConfig.project_id, /^appgprj_/);

  await Promise.all([
    access(new URL("../public/icon-192.png", import.meta.url)),
    access(new URL("../public/icon-512.png", import.meta.url)),
    access(new URL("../public/apple-touch-icon.png", import.meta.url)),
    access(new URL("../public/og-v2.png", import.meta.url)),
  ]);
});

test("keeps Keepa server-only and the watchlist durable", async () => {
  const [keepaRoute, keepaAdapter, schema, migration] = await Promise.all([
    readFile(new URL("../app/api/keepa/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/keepa.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../drizzle/0000_opposite_johnny_blaze.sql", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(keepaRoute, /serverKeepaApiKey/);
  assert.match(keepaRoute, /KEEPA_NOT_CONFIGURED/);
  assert.match(keepaRoute, /history:\s*"1"/);
  assert.match(keepaRoute, /days:\s*"90"/);
  assert.doesNotMatch(keepaRoute, /NEXT_PUBLIC_KEEPA/);
  assert.match(keepaAdapter, /GB:[\s\S]*domainId:\s*2/);
  assert.match(keepaAdapter, /FR:[\s\S]*domainId:\s*4/);
  assert.match(keepaAdapter, /IT:[\s\S]*domainId:\s*8/);
  assert.match(keepaAdapter, /ES:[\s\S]*domainId:\s*9/);
  assert.match(schema, /watchlistItems/);
  assert.match(migration, /CREATE TABLE `watchlist_items`/);
  assert.match(migration, /owner_id/);
});
