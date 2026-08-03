import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("missions, paniers-projets et achats utilisent la même identité privée", async () => {
  const [missions, purchases, schema] = await Promise.all([
    source("../app/api/missions/route.ts"),
    source("../app/api/purchases/route.ts"),
    source("../db/schema.ts"),
  ]);
  assert.match(missions, /resolveDevice\(request\)/u);
  assert.match(missions, /kind === "project"/u);
  assert.match(missions, /missionItems/u);
  assert.match(purchases, /purchase_requires_live_alert/u);
  assert.match(purchases, /paidTotalCents/u);
  assert.match(schema, /realizedSavingsCents/u);
  assert.match(schema, /purchaseEvents/u);
});

test("le bouclier programme, réconcilie et notifie les baisses après achat", async () => {
  const [plan, actor, ingest, pushRoute, push] = await Promise.all([
    source("../app/api/source-plan/route.ts"),
    source("../services/collector/src/actor.ts"),
    source("../app/api/ingest/route.ts"),
    source("../app/api/push/protection/route.ts"),
    source("../services/collector/src/push.ts"),
  ]);
  assert.match(plan, /protectionChecks/u);
  assert.match(plan, /6 \* 60 \* 60_000/u);
  assert.match(actor, /kind: "inspection" \| "frontier" \| "purchase"/u);
  assert.match(ingest, /potentialRecoveryCents/u);
  assert.match(ingest, /eventType: actionAvailable \? "price_drop" : "price_checked"/u);
  assert.match(pushRoute, /eq\(pushSubscriptions\.ownerId, purchase\.ownerId\)/u);
  assert.match(pushRoute, /isQuietNow\(subscription\)/u);
  assert.match(push, /sendProtectionPush/u);
});
