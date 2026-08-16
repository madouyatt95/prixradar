import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("le test Amazon Apple Samsung est appliqué de la collecte à l'affichage", async () => {
  const [actor, automation, keepa, ingest, alerts, application] = await Promise.all([
    source("../services/collector/src/actor.ts"),
    source("../services/collector/src/automation-plan.ts"),
    source("../services/collector/src/keepa.ts"),
    source("../app/api/ingest/route.ts"),
    source("../app/api/alerts/route.ts"),
    source("../app/components/price-radar-app.tsx"),
  ]);

  assert.match(automation, /amazonBrands:\s*\["Apple", "Samsung"\]/u);
  assert.match(actor, /targetBrands:\s*targetAmazonBrands/u);
  assert.match(keepa, /brand:\s*targetBrands/u);
  assert.match(keepa, /isTargetAmazonBrand\(product\.brand/u);
  assert.match(ingest, /AMAZON_BRAND_OUT_OF_SCOPE/u);
  assert.match(alerts, /'apple', 'apple inc', 'samsung', 'samsung electronics'/u);
  assert.match(application, /Apple et Samsung uniquement/u);
  assert.match(application, /"Actualiser"/u);
  assert.match(application, /cache:\s*"no-store"/u);
});
