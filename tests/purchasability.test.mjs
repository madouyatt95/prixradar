import assert from "node:assert/strict";
import test from "node:test";

import { assessPurchasability } from "../lib/purchasability.ts";

const now = Date.parse("2026-08-03T12:00:00.000Z");

test("une offre n'est achetable que si panier, variante, vendeur et fraîcheur concordent", () => {
  const result = assessPurchasability({
    sourceMode: "live",
    status: "active",
    verifiedAt: "2026-08-03T11:52:00.000Z",
    expiresAt: "2026-08-03T12:42:00.000Z",
    totalCents: 74_900,
    priceAccessibleToAll: true,
    cartStatus: "confirmed",
    variantConfidence: 94,
    sellerScore: 91,
    communityPositive: 8,
    communityNegative: 1,
  }, now);
  assert.equal(result.status, "confirmed");
  assert.equal(result.label, "Achetable maintenant");
  assert.equal(result.minutesRemaining, 42);
  assert.equal(result.community.confidencePercent, 89);
  assert.deepEqual(result.blockers, []);
});

test("un prix sans total final reste bloqué même s'il semble frais", () => {
  const result = assessPurchasability({
    sourceMode: "live",
    status: "active",
    verifiedAt: "2026-08-03T11:58:00.000Z",
    expiresAt: "2026-08-03T12:30:00.000Z",
    totalCents: null,
    priceAccessibleToAll: true,
    cartStatus: "product_page",
    variantConfidence: 94,
    sellerScore: 91,
  }, now);
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("total livré inconnu"));
  assert.ok(result.blockers.includes("panier final non confirmé"));
});
