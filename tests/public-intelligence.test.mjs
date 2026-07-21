import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateIntegrityIndex,
  computeReliabilityMetrics,
  evaluatePromotionIntegrity,
} from "../lib/public-intelligence.ts";
import { evaluateShadowCart } from "../lib/autonomy.ts";
import { buildCertifiedPassport } from "../lib/public-proof.ts";
import { verifiedCartEvidence } from "../lib/cart-proof.js";

const alert = (id, overrides = {}) => ({
  id,
  source: "darty",
  category: "TV",
  observedAt: "2026-07-22T10:00:00.000Z",
  verifiedAt: "2026-07-22T10:02:00.000Z",
  shippingCents: 0,
  status: "active",
  ...overrides,
});

test("calcule les taux publics sans transformer une absence de suivi en échec", () => {
  const result = computeReliabilityMetrics({
    alerts: [alert("alert-001"), alert("alert-002"), alert("alert-003", { shippingCents: null, verifiedAt: null })],
    feedback: [
      { alertId: "alert-001", verdict: "useful" },
      { alertId: "alert-002", verdict: "false_positive" },
      { alertId: "alert-003", verdict: "expired" },
    ],
    observations: [
      { alertId: "alert-001", available: true, observedAt: "2026-07-22T10:06:00.000Z" },
      { alertId: "alert-002", available: false, observedAt: "2026-07-22T10:07:00.000Z" },
      { alertId: "alert-001", available: true, observedAt: "2026-07-22T10:16:00.000Z" },
      { alertId: "alert-002", available: false, observedAt: "2026-07-22T10:16:00.000Z" },
      { alertId: "alert-001", available: true, observedAt: "2026-07-22T10:31:00.000Z" },
      { alertId: "alert-002", available: false, observedAt: "2026-07-22T10:31:00.000Z" },
    ],
    deliveries: [
      { alertId: "alert-001", sentAt: "2026-07-22T10:03:00.000Z" },
      { alertId: "alert-002", sentAt: "2026-07-22T10:07:00.000Z" },
      { alertId: "alert-001", sentAt: "2026-07-22T10:08:00.000Z" },
    ],
  }, { minimumRateSample: 2, minimumLatencySample: 2, minimumGroupSample: 2 });

  assert.equal(result.status, "measured");
  assert.equal(result.metrics.falsePositiveRate.value, 50);
  assert.equal(result.metrics.usefulAlertRate.value, 50);
  assert.equal(result.metrics.totalPriceKnownRate.value, 66.7);
  assert.equal(result.metrics.doubleVerificationRate.value, 66.7);
  assert.equal(result.metrics.notificationLatencyMedian.value, 5);
  assert.equal(result.metrics.availabilityAfterMinutes["5"].value, 50);
  assert.equal(result.metrics.availabilityAfterMinutes["5"].sampleSize, 2);
});

test("publie explicitement un échantillon insuffisant", () => {
  const result = computeReliabilityMetrics({
    alerts: [alert("alert-001")],
    feedback: [{ alertId: "alert-001", verdict: "useful" }],
    observations: [],
    deliveries: [],
  });
  assert.equal(result.status, "insufficient_sample");
  assert.equal(result.metrics.usefulAlertRate.status, "insufficient_sample");
  assert.equal(result.metrics.usefulAlertRate.value, null);
  assert.equal(result.metrics.availabilityAfterMinutes["5"].status, "unavailable");
});

test("indice de sincérité exige historique antérieur et comparaison marché", () => {
  const history = [1, 2, 3, 4, 5].map((day) => ({
    totalCents: 10_000,
    available: true,
    observedAt: `2026-07-${String(10 + day).padStart(2, "0")}T10:00:00.000Z`,
  }));
  const coherent = evaluatePromotionIntegrity({
    currentTotalCents: 7_000,
    observedDiscountPercent: 30,
    observedAt: "2026-07-22T10:00:00.000Z",
    history,
    marketMedianCents: 9_000,
    marketMerchantCount: 3,
  });
  assert.equal(coherent.status, "measured");
  assert.equal(coherent.inputs.lowestPrior30dCents, 10_000);
  assert.equal(coherent.measures.verified30dDiscountPercent, 30);
  assert.equal(coherent.score, 100);

  const fragile = evaluatePromotionIntegrity({
    currentTotalCents: 9_000,
    observedDiscountPercent: 50,
    observedAt: "2026-07-22T10:00:00.000Z",
    history,
    marketMedianCents: 10_000,
    marketMerchantCount: 3,
  });
  assert.equal(fragile.measures.discountGapPoints, 40);
  assert.equal(fragile.components.historyIntegrityScore, 0);
  assert.equal(fragile.score, 26);

  const insufficient = aggregateIntegrityIndex([coherent, fragile]);
  assert.equal(insufficient.status, "insufficient_sample");
  assert.equal(insufficient.score, null);
});

test("passeport certifié expose deux lectures mais aucune donnée propriétaire", () => {
  const passport = buildCertifiedPassport({
    generatedAt: "2026-07-22T10:03:00.000Z",
    alert: {
      id: "alert-live-001",
      source: "darty",
      sourceMode: "live",
      merchant: "Darty",
      market: "FR",
      title: "Téléviseur Test",
      brand: "Test",
      model: "TV-1",
      gtin: "1234567890123",
      category: "TV",
      url: "https://www.darty.com/test",
      currency: "EUR",
      priceCents: 70_000,
      shippingCents: 0,
      publicPriceCents: 70_000,
      priceAccessibleToAll: true,
      promotionType: "public_price",
      promotionLabel: null,
      condition: "new",
      seller: "Darty",
      score: 91,
      confidence: "very_likely",
      status: "active",
      evidenceJson: JSON.stringify({
        ownerId: "must-not-leak",
        secret: "must-not-leak",
        notificationEligible: true,
        analysis: {
          historyPoints: 8,
          robustZ: 4.2,
          marketSources: 3,
          checks: {
            secondVerification: true,
            exactVariant: true,
            trustedSeller: true,
            publicPriceAccessible: true,
            available: true,
          },
        },
      }),
      observedAt: "2026-07-22T10:00:00.000Z",
      verifiedAt: "2026-07-22T10:02:00.000Z",
      expiresAt: "2026-07-22T11:00:00.000Z",
    },
    intelligence: {
      variantJson: JSON.stringify({ comparable: true, attributes: { gtin: "1234567890123", model: "TV-1" } }),
      variantConfidence: 94,
      shadowCartStatus: "confirmed",
      shadowCartJson: JSON.stringify({ status: "confirmed", verified: true, consistent: true, identityConfirmed: true, explicitShipping: true, explicitTotal: true, couponApplied: true, finalTotalCents: 70_000, checkedAt: "2026-07-22T10:02:00.000Z" }),
      finalTotalCents: 70_000,
      sellerScore: 90,
      sellerJson: JSON.stringify({ level: "excellent", signals: { trusted: true, fulfillment: "direct", warranty: true, returns: true } }),
      priceIndexCents: 95_000,
      priceIndexJson: JSON.stringify({ merchantCount: 3 }),
      anomalyKind: "true_anomaly",
      anomalyJson: JSON.stringify({ evidenceStrength: 92 }),
      updatedAt: "2026-07-22T10:02:00.000Z",
    },
    observations: [{
      priceCents: 70_000,
      shippingCents: 0,
      totalCents: 70_000,
      available: true,
      observedAt: "2026-07-22T10:00:00.000Z",
    }],
    integrity: { status: "measured", score: 96 },
  });

  assert.equal(passport.certification.status, "certified");
  assert.equal(passport.readings.length, 2);
  assert.equal(passport.readings[1].type, "collector_verification");
  assert.equal(passport.total.finalTotalCents, 70_000);
  const serialized = JSON.stringify(passport);
  assert.doesNotMatch(serialized, /must-not-leak|ownerId|rawHash/u);
});

test("un panier sans total explicite ne peut pas devenir confirmé par repli", () => {
  const cart = evaluateShadowCart({
    status: "confirmed",
    itemCents: 70_000,
    shippingCents: null,
    totalCents: null,
    stockConfirmed: true,
    addToCartAvailable: true,
    identityConfirmed: true,
    explicitShipping: false,
    explicitTotal: false,
    couponApplied: true,
    checkedAt: "2026-07-22T10:02:00.000Z",
  }, { itemCents: 70_000, shippingCents: 0, available: true });
  assert.equal(cart.verified, false);
  assert.equal(cart.consistent, false);
  assert.equal(verifiedCartEvidence(JSON.stringify(cart)), false);
});

test("les contrats API branchent historique LIVE, métriques et preuve publique", async () => {
  const [alertsRoute, metricsRoute, certifiedRoute, integrityRoute] = await Promise.all([
    readFile(new URL("../app/api/alerts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public/metrics/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/certified/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/integrity/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(alertsRoute, /history: row\.sourceMode === "live"/u);
  assert.match(alertsRoute, /certificateUrl/u);
  assert.match(metricsRoute, /computeReliabilityMetrics/u);
  assert.match(certifiedRoute, /buildCertifiedPassport/u);
  assert.match(integrityRoute, /evaluatePromotionIntegrity/u);
  assert.doesNotMatch(certifiedRoute, /ownerId/u);
});
