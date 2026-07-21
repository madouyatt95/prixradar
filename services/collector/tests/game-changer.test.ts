import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBuyNow } from "../../../lib/buy-now.js";
import { optimizeCoverageBudgets } from "../../../lib/budget-optimizer.js";
import { parseRadarIntent, radarIntentMatches } from "../../../lib/radar-intent.js";

test("transforme une demande naturelle en règle de notification exploitable", () => {
  const intent = parseRadarIntent("Un iPhone neuf sous 850 €, livré en France, avec 25 % de remise");
  assert.equal(intent.maxPriceCents, 85_000);
  assert.equal(intent.minDiscount, 25);
  assert.equal(intent.condition, "new");
  assert.equal(intent.deliveryCountry, "FR");
  assert.ok(intent.brands.includes("apple") || intent.keywords.includes("iphone"));
  assert.equal(radarIntentMatches(intent, {
    title: "Apple iPhone 16 Pro 256 Go", brand: "Apple", category: "Smartphone", market: "FR",
    priceCents: 82_000, discountPercent: 28, condition: "new", accessibleToAll: true, deliveryCountry: "FR",
  }), true);
  assert.equal(radarIntentMatches(intent, {
    title: "Apple iPhone 16 Pro 256 Go", brand: "Apple", category: "Smartphone", market: "FR",
    priceCents: 90_000, discountPercent: 28, condition: "new", accessibleToAll: true, deliveryCountry: "FR",
  }), false);
});

test("sépare la confiance de détection de la décision d’achat", () => {
  const decision = evaluateBuyNow({
    anomalyScore: 94, discountPercent: 46, robustZ: 6, marketDiscountPercent: 31,
    historyPoints: 40, verificationCount: 2, sellerTrusted: true, available: true,
    shippingKnown: true, accessibleToAll: true, expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.ok(decision.score >= 80);
  assert.equal(decision.label, "Acheter maintenant");
  assert.equal(decision.factors.reduce((sum, factor) => sum + factor.maximum, 0), 100);
});

test("augmente seulement un budget rentable et réduit une source bloquée", () => {
  const [productive, blocked] = optimizeCoverageBudgets([
    { id: "good", currentBudget: 100, productsSeen: 1_000, exploitableAlerts: 20, costMicros: 1_000_000, antiBotBlocks: 0 },
    { id: "blocked", currentBudget: 100, productsSeen: 1_000, exploitableAlerts: 20, costMicros: 1_000_000, antiBotBlocks: 3 },
  ]);
  assert.equal(productive.action, "increase");
  assert.equal(productive.recommendedBudget, 125);
  assert.equal(blocked.action, "decrease");
  assert.equal(blocked.recommendedBudget, 70);
});
