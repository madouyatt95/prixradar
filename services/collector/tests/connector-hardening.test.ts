import assert from "node:assert/strict";
import test from "node:test";

import {
  CONNECTOR_REGISTRY_VERSION,
  connectorForUrl,
  connectorRegistrySnapshot,
  discoverNextPageUrl,
  extractRetailOffers,
} from "../src/connectors/index.js";

test("les quatre adaptateurs panier sont spécifiques et ne ciblent jamais achat immédiat ou paiement", () => {
  const urls = [
    "https://www.amazon.fr/dp/B012345678",
    "https://www.boulanger.com/ref/123456",
    "https://www.darty.com/nav/achat/informatique/ordinateur/fixture.html",
    "https://www.cdiscount.com/high-tech/fixture/f-106-fixture.html",
  ];
  const selectors = urls.map((url) => connectorForUrl(url).shadowCart.addButton);
  assert.equal(new Set(selectors.map((list) => list.join("|"))).size, 4);
  for (const list of selectors) {
    assert.ok(list.length >= 3);
    assert.equal(list.some((selector) => /buy.?now|checkout|payment|paiement|commande/iu.test(selector)), false);
  }
});

test("Boulanger sépare la référence demandée du SKU réellement rendu", () => {
  const html = `<html><head><link rel="canonical" href="https://www.boulanger.com/ref/EXPECTED-256"></head><body>
    <h1>Smartphone Exemple 256 Go noir</h1>
    <div data-product-id="OTHER-128"></div>
    <div data-testid="price">699,99 €</div>
    <div data-testid="shipping">Livraison gratuite</div>
    <div data-testid="seller">Boulanger</div>
    <div data-testid="availability">En stock</div>
    <div data-testid="condition">Neuf</div>
    <span data-testid="selected-capacity">128 Go</span>
  </body></html>`;
  const [offer] = extractRetailOffers(html, "https://www.boulanger.com/ref/EXPECTED-256", {
    requestedUrl: "https://www.boulanger.com/ref/EXPECTED-256",
  });
  assert.ok(offer);
  assert.equal(offer.variantIdentity?.expectedId, "sku:expected-256");
  assert.equal(offer.variantIdentity?.observedId, "sku:other-128");
  assert.deepEqual(offer.variantIdentity?.selectedOptions, { capacity: "128 go" });
});

test("Darty et Cdiscount prouvent les URL sans SKU public par leur canonical rendu", () => {
  const cases = [
    {
      url: "https://www.darty.com/nav/achat/informatique/ordinateur_portable/fixture_bleu.html",
      html: `<head><link rel="canonical" href="/nav/achat/informatique/ordinateur_portable/fixture_bleu.html"></head><body>
        <h1>Portable Fixture bleu</h1><div data-product-id="DARTY-9988"></div><div data-testid="price">799,99 €</div>
        <div class="delivery">Livraison gratuite</div><div class="seller">Darty</div><div class="availability">En stock</div><div class="condition">Neuf</div>
      </body>`,
      merchantId: "darty-9988",
    },
    {
      url: "https://www.cdiscount.com/high-tech/ordinateur/fixture/f-106-fixture.html",
      html: `<head><link rel="canonical" href="/high-tech/ordinateur/fixture/f-106-fixture.html"></head><body>
        <h1>Portable Fixture noir</h1><input name="ProductId" value="CD-4455"><div data-testid="price">749,99 €</div>
        <div class="shipping">Livraison gratuite</div><div class="seller">Cdiscount</div><div class="availability">En stock</div><div class="condition">Neuf</div>
      </body>`,
      merchantId: "cd-4455",
    },
  ] as const;
  for (const fixture of cases) {
    const [offer] = extractRetailOffers(fixture.html, fixture.url, { requestedUrl: fixture.url });
    assert.ok(offer);
    assert.ok(offer.variantIdentity?.expectedId?.startsWith("path:/"));
    assert.equal(offer.variantIdentity?.observedId, offer.variantIdentity?.expectedId);
    assert.equal(offer.variantIdentity?.observedSource, "canonical_link");
    assert.equal(offer.variantIdentity?.merchantProductId, fixture.merchantId);
  }
});

test("le registre est versionné et la pagination avance d'une seule page sous une borne dure", () => {
  const registry = connectorRegistrySnapshot();
  assert.equal(registry.length, 8);
  assert.ok(registry.every((entry) => entry.version === CONNECTOR_REGISTRY_VERSION));
  const page = "https://www.amazon.fr/s?k=ordinateur&page=1";
  assert.equal(
    discoverNextPageUrl(`<link rel="next" href="/s?k=ordinateur&page=2&ref=sr_pg_1">`, page),
    "https://www.amazon.fr/s?k=ordinateur&page=2",
  );
  assert.equal(discoverNextPageUrl(`<link rel="next" href="/s?k=ordinateur&page=4">`, page), null);
  assert.equal(discoverNextPageUrl(`<link rel="next" href="https://evil.example/s?k=x&page=2">`, page), null);
  assert.equal(
    discoverNextPageUrl(`<link rel="next" href="/s?k=ordinateur&page=21">`, "https://www.amazon.fr/s?k=ordinateur&page=20"),
    null,
  );
});
