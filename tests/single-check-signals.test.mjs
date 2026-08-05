import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("sépare les signaux 1/2 des alertes confirmées et conserve le lien marchand", async () => {
  const [route, interfaceSource, sink] = await Promise.all([
    source("../app/api/alerts/route.ts"),
    source("../app/components/price-radar-app.tsx"),
    source("../services/collector/src/sink.ts"),
  ]);
  assert.match(route, /view !== "confirmed" && view !== "single_check"/u);
  assert.match(route, /analysis\.checks\.secondVerification/u);
  assert.match(route, /certificateUrl: liveEligible/u);
  assert.match(interfaceSource, /Signaux à confirmer/u);
  assert.match(interfaceSource, /Voir le produit ↗/u);
  assert.match(interfaceSource, /0 jeton Keepa/u);
  assert.match(sink, /verificationCount: observation\.verification\.status === "confirmed" \? 2 : 1/u);
  assert.match(sink, /toAlertIngestEnvelope\(observation, false\)/u);
});
