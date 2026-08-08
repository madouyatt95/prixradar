import assert from "node:assert/strict";
import test from "node:test";

import { isExtremeRetailCandidate, isJdSportsAccessory } from "../src/deal-policy.js";
import type { OfferSnapshot } from "../src/types.js";

function offer(overrides: Partial<OfferSnapshot> & { title?: string; category?: string | null } = {}): OfferSnapshot {
  return {
    product: {
      productKey: "jd_sports:fr:test",
      source: "jd_sports",
      market: "FR",
      externalId: "test",
      title: overrides.title ?? "Nike Air Max 95",
      brand: "Nike",
      model: "Air Max 95",
      gtin: null,
      category: overrides.category ?? "Chaussures",
      url: "https://m.jdsports.fr/product/test",
      imageUrl: null,
    },
    price: { amountMinor: 3_000, currency: "EUR" },
    shipping: null,
    total: null,
    referencePrice: { amountMinor: 10_000, currency: "EUR" },
    seller: "JD Sports",
    sellerTrusted: true,
    condition: "new",
    availability: "in_stock",
    observedAt: "2026-08-08T20:00:00.000Z",
    strategy: "connector",
    fixture: true,
    ...overrides,
  };
}

test("retient une baisse publique de 70 % et rejette 69 %", () => {
  assert.equal(isExtremeRetailCandidate(offer()), true);
  assert.equal(isExtremeRetailCandidate(offer({ price: { amountMinor: 3_100, currency: "EUR" } })), false);
});

test("écarte les accessoires JD Sports même avec une forte remise", () => {
  const accessory = offer({ title: "Lot de 6 chaussettes Nike", category: "Accessoires" });
  assert.equal(isJdSportsAccessory(accessory), true);
  assert.equal(isExtremeRetailCandidate(accessory), false);
});

test("ne bloque pas la politique historique Amazon", () => {
  const amazon = offer({
    product: { ...offer().product, source: "amazon", productKey: "amazon:fr:test", url: "https://www.amazon.fr/dp/B012345678" },
    referencePrice: null,
  });
  assert.equal(isExtremeRetailCandidate(amazon), true);
});
