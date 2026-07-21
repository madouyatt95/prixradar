import assert from "node:assert/strict";
import test from "node:test";

import { connectorForUrl, extractRetailOffers } from "../src/connectors/index.js";

test("autorise les cinq domaines Amazon EU et extrait les garde-fous de la page", () => {
  assert.equal(connectorForUrl("https://www.amazon.co.uk/dp/B012345678").market, "GB");
  const html = `
    <html><head><meta property="og:image" content="https://images.example/product.jpg"></head><body>
      <h1 id="productTitle">Produit Amazon vérifié</h1>
      <input name="ASIN" value="B012345678">
      <div id="corePrice_feature_div"><span class="a-offscreen">109,99 €</span></div>
      <div class="basisPrice"><span class="a-offscreen">199,99 €</span></div>
      <div id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE">Livraison GRATUITE</div>
      <div id="merchant-info">Vendu par Amazon</div>
      <div id="availability">En stock</div>
      <div id="newAccordionRow">Neuf</div>
    </body></html>`;
  const [offer] = extractRetailOffers(html, "https://www.amazon.fr/dp/B012345678", {
    observedAt: "2026-07-21T09:00:00.000Z",
  });
  assert.ok(offer);
  assert.equal(offer.product.externalId, "B012345678");
  assert.equal(offer.shipping?.amountMinor, 0);
  assert.equal(offer.total?.amountMinor, 10_999);
  assert.equal(offer.sellerTrusted, true);
  assert.equal(offer.availability, "in_stock");
  assert.equal(offer.condition, "new");
  assert.equal(offer.promotion?.accessibleToAll, true);
});

test("sépare un coupon conditionnel du prix public", () => {
  const html = `<html><body>
    <h1>Produit avec coupon</h1><div data-product-id="12345"></div>
    <div data-testid="price">99,99 €</div><div data-testid="shipping">Livraison gratuite</div>
    <div data-testid="seller">Boulanger</div><div data-testid="availability">En stock</div>
    <div data-testid="condition">Neuf</div><div data-testid="coupon">Coupon de 20 € à appliquer</div>
  </body></html>`;
  const [offer] = extractRetailOffers(html, "https://www.boulanger.com/ref/12345");
  assert.ok(offer);
  assert.deepEqual(offer.promotion, { type: "coupon", label: "Coupon de 20 € à appliquer", accessibleToAll: false });
});
