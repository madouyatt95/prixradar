import assert from "node:assert/strict";
import test from "node:test";

import { cartTextMatchesOffer } from "../src/crawler.js";
import type { OfferSnapshot } from "../src/types.js";
import { hasExactVariantEvidence, verifyWithSecondRead } from "../src/verify.js";

function verifiedOffer(overrides: Partial<OfferSnapshot> = {}): OfferSnapshot {
  return {
    product: {
      productKey: "amazon:fr:B012345678",
      source: "amazon",
      market: "FR",
      externalId: "B012345678",
      title: "Apple iPhone 16 Pro 256 Go Titane noir",
      brand: "Apple",
      model: "iPhone 16 Pro",
      gtin: "0195949771234",
      url: "https://www.amazon.fr/dp/B012345678",
      imageUrl: null,
    },
    variantIdentity: {
      expectedId: "asin:b012345678",
      observedId: "asin:b012345678",
      expectedSource: "request_url",
      observedSource: "merchant_dom",
      merchantProductId: "b012345678",
      gtin: "0195949771234",
      selectedOptions: { capacity: "256 go", color: "titane noir" },
    },
    price: { amountMinor: 99_900, currency: "EUR" },
    shipping: { amountMinor: 0, currency: "EUR" },
    total: { amountMinor: 99_900, currency: "EUR" },
    referencePrice: { amountMinor: 129_900, currency: "EUR" },
    seller: "Amazon",
    sellerTrusted: true,
    condition: "new",
    availability: "in_stock",
    observedAt: "2026-07-22T10:00:00.000Z",
    strategy: "connector",
    fixture: false,
    promotion: { type: "public_price", label: null, accessibleToAll: true },
    cartProbe: {
      status: "confirmed",
      itemCents: 99_900,
      shippingCents: 0,
      totalCents: 99_900,
      stockConfirmed: true,
      addToCartAvailable: true,
      identityConfirmed: true,
      explicitShipping: true,
      explicitTotal: true,
      couponApplied: true,
      checkedAt: "2026-07-22T10:00:00.000Z",
    },
    ...overrides,
  };
}

async function twoReads(first: OfferSnapshot, second: OfferSnapshot) {
  let count = 0;
  return verifyWithSecondRead(async () => (count++ === 0 ? first : second), {
    delayMs: 0,
    sleep: async () => undefined,
  });
}

test("confirme seulement deux preuves de variante indépendantes et strictement identiques", async () => {
  const first = verifiedOffer();
  const second = structuredClone(first);
  second.observedAt = "2026-07-22T10:00:03.000Z";
  second.cartProbe!.checkedAt = "2026-07-22T10:00:03.000Z";
  const result = await twoReads(first, second);
  assert.equal(hasExactVariantEvidence(result.offer), true);
  assert.equal(result.verification.status, "confirmed");
  assert.deepEqual({
    identity: result.verification.matchingIdentity,
    seller: result.verification.matchingSeller,
    condition: result.verification.matchingCondition,
    shipping: result.verification.matchingShipping,
    total: result.verification.matchingTotal,
    cart: result.verification.matchingCart,
  }, { identity: true, seller: true, condition: true, shipping: true, total: true, cart: true });
});

test("rejette une variante rendue différente même si productKey et prix restent identiques", async () => {
  const second = verifiedOffer();
  second.variantIdentity = {
    ...second.variantIdentity!,
    observedId: "asin:b099999999",
    merchantProductId: "b099999999",
    selectedOptions: { capacity: "128 go", color: "titane noir" },
  };
  const result = await twoReads(verifiedOffer(), second);
  assert.equal(result.verification.matchingIdentity, false);
  assert.equal(result.verification.status, "rejected");
});

test("rejette tout changement de vendeur, livraison, total ou panier à la seconde lecture", async () => {
  const second = verifiedOffer({
    seller: "Marketplace Exemple",
    sellerTrusted: false,
    shipping: { amountMinor: 499, currency: "EUR" },
    total: { amountMinor: 100_399, currency: "EUR" },
    cartProbe: {
      status: "confirmed",
      itemCents: 99_900,
      shippingCents: 499,
      totalCents: 100_399,
      stockConfirmed: true,
      addToCartAvailable: true,
      identityConfirmed: true,
      explicitShipping: true,
      explicitTotal: true,
      couponApplied: true,
      checkedAt: "2026-07-22T10:00:03.000Z",
    },
  });
  const result = await twoReads(verifiedOffer(), second);
  assert.equal(result.verification.matchingSeller, false);
  assert.equal(result.verification.matchingShipping, false);
  assert.equal(result.verification.matchingTotal, false);
  assert.equal(result.verification.matchingCart, false);
  assert.equal(result.verification.matchingPrice, false);
  assert.equal(result.verification.status, "rejected");
});

test("un ancien snapshot sans preuve observée ne peut plus s'auto-certifier", async () => {
  const legacy = verifiedOffer();
  delete legacy.variantIdentity;
  const result = await twoReads(legacy, structuredClone(legacy));
  assert.equal(result.verification.matchingIdentity, false);
  assert.equal(result.verification.status, "rejected");
});

test("la confirmation panier exige l'identité produit et pas seulement le mot panier", () => {
  const offer = verifiedOffer();
  assert.equal(cartTextMatchesOffer("Ajouté au panier · Apple iPhone 16 Pro 256 Go · 999,00 €", offer), true);
  assert.equal(cartTextMatchesOffer("Ajouté au panier · Coque universelle · 19,00 €", offer), false);
});
