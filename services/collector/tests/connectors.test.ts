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
  assert.equal(offer.variantIdentity?.expectedId, "asin:b012345678");
  assert.equal(offer.variantIdentity?.observedId, "asin:b012345678");
  assert.equal(offer.variantIdentity?.expectedSource, "request_url");
  assert.equal(offer.variantIdentity?.observedSource, "merchant_dom");
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

test("les six nouveaux adaptateurs extraient une offre directe et prouvent la référence URL", () => {
  const fixtures = [
    { source: "fnac", url: "https://www.fnac.com/a21851909/produit-test", id: "21851909", seller: "Fnac" },
    { source: "carrefour", url: "https://www.carrefour.fr/p/produit-test-5904204753289", id: "5904204753289", seller: "Carrefour" },
    { source: "leroy_merlin", url: "https://www.leroymerlin.fr/produits/produit-test-80159772.html", id: "80159772", seller: "Leroy Merlin" },
    { source: "castorama", url: "https://www.castorama.fr/produit-test/5059340904245_CAFR.prd", id: "5059340904245", seller: "Castorama" },
    { source: "conforama", url: "https://www.conforama.fr/meuble/produit-test/p/M78384060", id: "M78384060", seller: "Conforama" },
    { source: "rueducommerce", url: "https://www.rueducommerce.fr/p/r24060027222.html", id: "r24060027222", seller: "Rue du Commerce" },
  ] as const;

  for (const fixture of fixtures) {
    const html = `<html><body>
      <h1>Produit test ${fixture.seller}</h1>
      <div data-product-id="${fixture.id}"></div>
      <div data-testid="product-price">99,99 €</div>
      <div data-testid="shipping">Livraison gratuite</div>
      <div data-testid="seller">${fixture.seller}</div>
      <div data-testid="availability">En stock</div>
      <div data-testid="condition">Neuf</div>
    </body></html>`;
    const connector = connectorForUrl(fixture.url);
    const [offer] = extractRetailOffers(html, fixture.url, { fixture: true, requestedUrl: fixture.url });
    assert.equal(connector.source, fixture.source);
    assert.ok(offer, fixture.source);
    assert.equal(offer.product.source, fixture.source);
    assert.equal(offer.sellerTrusted, true);
    assert.equal(offer.price.amountMinor, 9_999);
    assert.equal(offer.shipping?.amountMinor, 0);
    assert.equal(offer.variantIdentity?.expectedId, `sku:${fixture.id.toLowerCase()}`);
    assert.equal(offer.variantIdentity?.observedId, `sku:${fixture.id.toLowerCase()}`);
  }
});

test("les places de marché Fnac et Rue du Commerce restent non fiables par défaut", () => {
  const fixtures = [
    { url: "https://www.fnac.com/mp12345678/produit-test/w-4", id: "12345678" },
    { url: "https://www.rueducommerce.fr/p/m24060027222.html", id: "m24060027222" },
  ] as const;
  for (const fixture of fixtures) {
    const html = `<h1>Produit marketplace</h1><div data-product-id="${fixture.id}"></div>
      <div data-testid="product-price">89,99 €</div><div data-testid="shipping">4,99 €</div>
      <div data-testid="seller">Vendeur partenaire</div><div data-testid="availability">En stock</div>`;
    const [offer] = extractRetailOffers(html, fixture.url, { fixture: true, requestedUrl: fixture.url });
    assert.ok(offer);
    assert.equal(offer.sellerTrusted, false);
    assert.equal(offer.total?.amountMinor, 9_498);
  }
});

test("JD Sports extrait la référence, le prix et le stock depuis la fiche publique", () => {
  const url = "https://www.jdsports.fr/product/noir-lacoste-sac-messenger-croc-tech/19735246_jdsportsfr/";
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Lacoste Sac Messenger Croc Tech",
    sku: "19735246_jdsportsfr",
    brand: { "@type": "Brand", name: "Lacoste" },
    url,
    offers: {
      "@type": "Offer",
      price: "60.00",
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "JD Sports" },
    },
  })}</script></head><body><h1 data-e2e="product-name">Lacoste Sac Messenger Croc Tech</h1><button id="addCToBasket">Ajouter au panier</button></body></html>`;
  const [offer] = extractRetailOffers(html, url, { fixture: true, requestedUrl: url });
  assert.ok(offer);
  assert.equal(offer.product.source, "jd_sports");
  assert.equal(offer.product.externalId, "19735246_jdsportsfr");
  assert.equal(offer.price.amountMinor, 6_000);
  assert.equal(offer.shipping, null);
  assert.equal(offer.sellerTrusted, true);
  assert.equal(offer.availability, "in_stock");
  assert.equal(offer.variantIdentity?.expectedId, "sku:19735246_jdsportsfr");
  assert.equal(offer.variantIdentity?.observedId, "sku:19735246_jdsportsfr");
});

test("JD Sports extrait les prix des cartes catégorie sans inventer la livraison", () => {
  const categoryUrl = "https://m.jdsports.fr/promo/c/chaussures/";
  const html = `<span class="itemContainer" data-productsku="19742720_jdsportsfr">
    <a href="/product/blanc-new-balance-740-enfant/19742720_jdsportsfr/" data-e2e="plp-productList-link">
      <img class="thumbnail" alt="New Balance 740 Enfant" src="https://images.example/740.jpg">
    </a>
    <span class="itemTitle"><a href="/product/blanc-new-balance-740-enfant/19742720_jdsportsfr/" data-e2e="product-listing-name">New Balance 740 Enfant</a></span>
    <div class="itemPrice">
      <span class="was">Était <span data-oi-price>200,00€</span></span>
      <span class="now" data-e2e="product-listing-price">Maintenant <span data-oi-price>55,00€</span></span>
    </div>
  </span>`;
  const [offer] = extractRetailOffers(html, categoryUrl, {
    fixture: true,
    observedAt: "2026-08-09T12:00:00.000Z",
    requestedUrl: categoryUrl,
  });
  assert.ok(offer);
  assert.equal(offer.product.externalId, "19742720_jdsportsfr");
  assert.equal(offer.product.url, "https://www.jdsports.fr/product/blanc-new-balance-740-enfant/19742720_jdsportsfr/");
  assert.equal(offer.product.category, "Chaussures");
  assert.equal(offer.price.amountMinor, 5_500);
  assert.equal(offer.referencePrice?.amountMinor, 20_000);
  assert.equal(offer.shipping, null);
  assert.equal(offer.total, null);
  assert.equal(offer.verificationScope, "category_listing");
  assert.equal(offer.sellerTrusted, true);
  assert.equal(offer.variantIdentity?.expectedSource, "listing_link");
  assert.equal(offer.variantIdentity?.expectedId, "sku:19742720_jdsportsfr");
  assert.equal(offer.variantIdentity?.observedId, "sku:19742720_jdsportsfr");
});
