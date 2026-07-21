import assert from "node:assert/strict";
import test from "node:test";

import { scoreOffer } from "../src/scoring.js";
import { notificationEligible, verifyWithSecondRead } from "../src/verify.js";
import type { OfferSnapshot } from "../src/types.js";

function offer(overrides: Partial<OfferSnapshot> = {}): OfferSnapshot {
  return {
    product: {
      productKey: "darty:fr:fixture",
      source: "darty",
      market: "FR",
      externalId: "FIXTURE-1",
      title: "Produit fixture",
      brand: "FixtureBrand",
      model: "MODEL-1",
      gtin: "1234567890123",
      url: "https://www.darty.com/nav/achat/fixture.html",
      imageUrl: null,
    },
    variantIdentity: {
      expectedId: "path:/nav/achat/fixture.html",
      observedId: "path:/nav/achat/fixture.html",
      expectedSource: "request_url",
      observedSource: "canonical_link",
      merchantProductId: "fixture-1",
      gtin: "1234567890123",
      selectedOptions: {},
    },
    price: { amountMinor: 20_000, currency: "EUR" },
    shipping: { amountMinor: 0, currency: "EUR" },
    total: { amountMinor: 20_000, currency: "EUR" },
    referencePrice: { amountMinor: 50_000, currency: "EUR" },
    seller: "Darty",
    sellerTrusted: true,
    condition: "new",
    availability: "in_stock",
    observedAt: "2026-07-21T10:00:00.000Z",
    strategy: "json-ld",
    fixture: false,
    ...overrides,
  };
}

test("le scoring reste explicable et exige une baisse substantielle", () => {
  const strong = scoreOffer(offer());
  assert.equal(strong.classification, "strong");
  assert.equal(strong.discountPercent, 60);
  assert.ok(strong.reasons.length >= 2);

  const ordinary = scoreOffer(offer({ total: { amountMinor: 48_000, currency: "EUR" } }));
  assert.equal(ordinary.classification, "none");
});

test("deux lectures identiques confirment mais une fixture ne notifie jamais", async () => {
  let reads = 0;
  const verified = await verifyWithSecondRead(async () => ({
    ...offer({ fixture: true }),
    observedAt: `2026-07-21T10:00:0${reads++}.000Z`,
  }), { delayMs: 0, sleep: async () => undefined });
  assert.equal(verified.verification.status, "confirmed");
  assert.equal(verified.alertCandidateId, "darty:fr:fixture");
  assert.equal(notificationEligible(verified), false);
});

test("un changement de prix entre deux lectures est rejeté", async () => {
  let reads = 0;
  const verified = await verifyWithSecondRead(async () => {
    reads += 1;
    return offer({
      price: { amountMinor: reads === 1 ? 20_000 : 21_000, currency: "EUR" },
      total: { amountMinor: reads === 1 ? 20_000 : 21_000, currency: "EUR" },
      observedAt: `2026-07-21T10:00:0${reads}.000Z`,
    });
  }, { delayMs: 0, sleep: async () => undefined });
  assert.equal(verified.verification.status, "rejected");
  assert.equal(verified.verification.matchingPrice, false);
  assert.equal(notificationEligible(verified), false);
});
