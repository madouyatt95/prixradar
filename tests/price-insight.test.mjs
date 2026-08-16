import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildPriceInsight } from "../lib/price-insight.ts";

const point = (observedAt, totalCents) => ({ observedAt, totalCents, available: true });

test("neutralise un pic isolé et ferme un faux prix barré Amazon", () => {
  const insight = buildPriceInsight({
    currentTotalCents: 5_736,
    observedAt: "2026-08-09T12:00:00.000Z",
    fallbackBaselineCents: 9_425,
    history: [
      point("2026-05-17T12:00:00.000Z", 5_329),
      point("2026-05-28T12:00:00.000Z", 15_227),
      point("2026-06-11T12:00:00.000Z", 5_407),
      point("2026-07-10T12:00:00.000Z", 5_822),
      point("2026-08-02T12:00:00.000Z", 5_736),
    ],
  });
  assert.equal(insight.classification, "normal_price");
  assert.equal(insight.shouldAutoClose, true);
  assert.ok((insight.baselineCents ?? 0) < 6_000);
});

test("distingue une erreur probable fraîche d'un bon prix devenu stable", () => {
  const history = [
    point("2026-05-15T12:00:00.000Z", 10_000),
    point("2026-06-01T12:00:00.000Z", 10_200),
    point("2026-06-20T12:00:00.000Z", 9_900),
    point("2026-07-05T12:00:00.000Z", 10_100),
    point("2026-07-25T12:00:00.000Z", 10_000),
    point("2026-08-08T12:00:00.000Z", 10_000),
  ];
  const fresh = buildPriceInsight({ currentTotalCents: 4_000, observedAt: "2026-08-09T12:00:00.000Z", history });
  assert.equal(fresh.classification, "probable_error");
  assert.ok((fresh.rarityScore ?? 0) >= 85);
  assert.equal(fresh.lastDropAt, "2026-08-09T12:00:00.000Z");

  const stable = buildPriceInsight({
    currentTotalCents: 7_000,
    observedAt: "2026-08-09T12:00:00.000Z",
    history: [...history.slice(0, -1), point("2026-08-03T12:00:00.000Z", 7_000)],
  });
  assert.equal(stable.classification, "stable_good_price");
  assert.equal(stable.shouldAutoClose, false);
});

test("l'interface ne barre que la référence réellement affichée par l'enseigne", async () => {
  const [application, alertsRoute] = await Promise.all([
    readFile(new URL("../app/components/price-radar-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/alerts/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(application, /reference\.crossedOut/);
  assert.match(application, /Habituel estimé/);
  assert.doesNotMatch(application, /<del>\{money\(alert\.usualPrice/u);
  assert.match(application, /Comparaison entre enseignes/);
  assert.match(application, /Rareté/);
  assert.match(alertsRoute, /const displayedDiscountPercent = merchantReferenceCents !== null/u);
  assert.match(alertsRoute, /merchantReferenceCents - \(totalCents \?\? row\.priceCents\)/u);
  assert.match(alertsRoute, /classificationLabel: "Baisse affichée"/u);
  assert.match(alertsRoute, /prix barré affiché par l’enseigne/u);
  assert.match(alertsRoute, /merchantReferenceCents !== null && history\.length === 0/u);
});
