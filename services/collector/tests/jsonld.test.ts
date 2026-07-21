import assert from "node:assert/strict";
import test from "node:test";

import { extractJsonLdOffers } from "../src/connectors/jsonld.js";

const FIXTURE_HTML = `<!doctype html>
<html><head><script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [{
    "@type": "Product",
    "name": "Téléviseur Fixture 55 pouces",
    "sku": "FIXTURE-TV-55",
    "brand": {"@type": "Brand", "name": "FixtureBrand"},
    "image": "https://images.example.test/fixture-tv.jpg",
    "offers": {
      "@type": "Offer",
      "url": "/ref/FIXTURE-TV-55?utm_campaign=fixture",
      "price": "499,99",
      "highPrice": "899.99",
      "priceCurrency": "EUR",
      "availability": "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      "seller": {"name": "Boulanger Fixture"}
    }
  }]
}
</script></head></html>`;

test("extrait et normalise un Product JSON-LD sans transformer la fixture en donnée réelle", () => {
  const offers = extractJsonLdOffers(FIXTURE_HTML, {
    source: "boulanger",
    market: "FR",
    currency: "EUR",
    pageUrl: "https://www.boulanger.com/ref/FIXTURE-TV-55",
    allowedHosts: new Set(["www.boulanger.com"]),
    observedAt: "2026-07-21T10:00:00.000Z",
    fixture: true,
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.price.amountMinor, 49_999);
  assert.equal(offers[0]?.referencePrice?.amountMinor, 89_999);
  assert.equal(offers[0]?.availability, "in_stock");
  assert.equal(offers[0]?.product.url, "https://www.boulanger.com/ref/FIXTURE-TV-55");
  assert.equal(offers[0]?.fixture, true);
});

test("ignore un bloc JSON-LD malformé et refuse une URL sortant de l’allowlist", () => {
  assert.deepEqual(extractJsonLdOffers('<script type="application/ld+json">{oops</script>', {
    source: "darty",
    market: "FR",
    currency: "EUR",
    pageUrl: "https://www.darty.com/nav/achat/fixture.html",
    allowedHosts: new Set(["www.darty.com"]),
    fixture: true,
  }), []);

  const hostile = FIXTURE_HTML.replace("/ref/FIXTURE-TV-55?utm_campaign=fixture", "https://evil.example/item");
  assert.throws(() => extractJsonLdOffers(hostile, {
    source: "boulanger",
    market: "FR",
    currency: "EUR",
    pageUrl: "https://www.boulanger.com/ref/FIXTURE-TV-55",
    allowedHosts: new Set(["www.boulanger.com"]),
    fixture: true,
  }));
});
