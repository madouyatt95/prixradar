import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProductUrl, parseMoneyMinor, productKey } from "../src/normalize.js";

test("normalise les formats de prix français et internationaux en unité mineure", () => {
  assert.equal(parseMoneyMinor("1 299,99 €"), 129_999);
  assert.equal(parseMoneyMinor("1.299,99 EUR"), 129_999);
  assert.equal(parseMoneyMinor("1,299.99"), 129_999);
  assert.equal(parseMoneyMinor("299 €"), 29_900);
  assert.equal(parseMoneyMinor(12.34), 1_234);
  assert.equal(parseMoneyMinor("-10,00"), null);
});

test("refuse les hôtes non autorisés et retire le tracking", () => {
  const hosts = new Set(["www.boulanger.com"]);
  assert.equal(
    normalizeProductUrl("https://www.boulanger.com/ref/123?utm_source=test&color=noir", hosts),
    "https://www.boulanger.com/ref/123?color=noir",
  );
  assert.throws(() => normalizeProductUrl("https://evil.example/ref/123", hosts));
});

test("crée une identité produit stable", () => {
  const first = productKey({ source: "darty", market: "FR", externalId: "ABC-123" });
  const second = productKey({ source: "darty", market: "FR", externalId: " abc-123 " });
  assert.equal(first, second);
  assert.match(first, /^darty:fr:[a-f0-9]{24}$/u);
});
