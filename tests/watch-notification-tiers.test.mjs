import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("les signaux à vérifier ne réclament ni historique, ni livraison, ni seconde lecture", async () => {
  const [ingest, targets, deliveries, worker] = await Promise.all([
    readFile(new URL("../app/api/ingest/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/push/targets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/push/deliveries/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/collector/src/worker.ts", import.meta.url), "utf8"),
  ]);
  assert.match(ingest, /const broadWatchEligible = evaluation\.score >= 35/u);
  assert.match(ingest, /deliveryEligible = parsed\.notify/u);
  assert.match(targets, /alertLevel !== "watch" && historyPoints < row\.minimumHistoryPoints/u);
  assert.match(deliveries, /alertLevel === "watch" \? 35 : 65/u);
  assert.match(deliveries, /alertLevel === "watch" \|\| alert\.shippingCents !== null/u);
  assert.match(worker, /requestNotification: options\.allowPush \?\? true/u);
  assert.match(worker, /ingested\.alert\.alertLevel === "watch"/u);
});
