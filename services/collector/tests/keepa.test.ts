import assert from "node:assert/strict";
import test from "node:test";

import { KEEPA_MARKETS, KeepaApiError, KeepaClient, scanKeepaMarket } from "../src/keepa.js";

test("déclare exactement les cinq marchés Amazon Europe couverts", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(KEEPA_MARKETS).map(([market, config]) => [market, config.domainId])), {
    GB: 2, DE: 3, FR: 4, IT: 8, ES: 9,
  });
});

test("enchaîne /deal puis /product, normalise les centimes et expose le quota", async () => {
  const paths: string[] = [];
  const client = new KeepaClient({
    apiKey: "KEEPA_SECRET_TEST",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === "/deal") {
        const selection = JSON.parse(url.searchParams.get("selection") ?? "{}") as { domainId?: number };
        assert.equal(selection.domainId, 4);
        return Response.json({
          tokensLeft: 12,
          refillIn: 1000,
          refillRate: 5,
          deals: { dr: [{ asin: "B012345678", current: [5000], lastUpdate: 8_000_000 }] },
        });
      }
      assert.equal(url.searchParams.get("domain"), "4");
      return Response.json({
        tokensLeft: 10,
        refillIn: 1000,
        refillRate: 5,
        products: [{
          asin: "B012345678",
          title: "Produit Keepa Fixture",
          brand: "Fixture",
          buyBoxIsAmazon: true,
          stats: {
            current: [5000, -1, -1, -1, 9000, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
            avg90: [10000, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
          },
          csv: [],
        }],
      });
    },
  });

  const observations = await scanKeepaMarket(client, "FR", { fixture: true });
  assert.deepEqual(paths, ["/deal", "/product"]);
  assert.equal(observations[0]?.offer.price.amountMinor, 5_000);
  assert.equal(observations[0]?.offer.total, null);
  assert.equal(observations[0]?.offer.sellerTrusted, true);
  assert.equal(observations[0]?.offer.referencePrice?.amountMinor, 10_000);
  assert.equal(observations[0]?.offer.fixture, true);
  assert.equal(client.quota.tokensLeft, 10);
});

test("les erreurs Keepa n’exposent jamais la clé", async () => {
  const apiKey = "ULTRA_SECRET_KEEPA_KEY";
  const client = new KeepaClient({
    apiKey,
    fetchImpl: async () => new Response("details", { status: 403 }),
  });
  await assert.rejects(client.deals("DE"), (error: unknown) => {
    assert.ok(error instanceof KeepaApiError);
    assert.equal(String(error).includes(apiKey), false);
    return true;
  });
});
