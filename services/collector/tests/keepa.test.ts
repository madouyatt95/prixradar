import assert from "node:assert/strict";
import test from "node:test";

import { KEEPA_MARKETS, KeepaApiError, KeepaClient, isExcludedAmazonProduct, isTargetAmazonBrand, keepaOffer, mergeKeepaWithLive, scanKeepaMarket } from "../src/keepa.js";

test("déclare exactement les cinq marchés Amazon Europe couverts", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(KEEPA_MARKETS).map(([market, config]) => [market, config.domainId])), {
    GB: 2, DE: 3, FR: 4, IT: 8, ES: 9,
  });
});

test("conserve une Buy Box tierce en la distinguant d'Amazon", () => {
  const snapshot = keepaOffer({
    asin: "B012345678", market: "FR", title: "Produit marketplace", brand: null, model: null, gtin: null,
    currentMinor: 5_000, referenceMinor: 10_000, referenceSource: "keepa_average", observedAt: "2026-08-08T20:00:00.000Z", imageUrl: null,
    buyBoxIsAmazon: false, buyBoxIsFba: true, buyBoxSellerId: "A1MARKETPLACE", history: [], categoryPath: ["High-Tech"], productGroup: "Electronics",
  });
  assert.equal(snapshot.seller, "Vendeur tiers Amazon · A1MARKETPLACE");
  assert.equal(snapshot.sellerTrusted, false);
  assert.equal(snapshot.sellerSignals?.fulfillment, "platform");
});

test("enchaîne /deal puis /product, normalise les centimes et expose le quota", async () => {
  const paths: string[] = [];
  let dealSelection: Record<string, unknown> = {};
  const client = new KeepaClient({
    apiKey: "KEEPA_SECRET_TEST",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === "/deal") {
        const selection = JSON.parse(url.searchParams.get("selection") ?? "{}") as { domainId?: number };
        dealSelection = selection;
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
          brand: "Apple",
          categoryTree: [{ catId: 172282, name: "High-Tech" }],
          productGroup: "Electronics",
          stats: {
            current: [5000, -1, -1, -1, 9000, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 5000],
            avg90: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 10000],
            buyBoxIsAmazon: true,
            buyBoxIsFBA: true,
            buyBoxSellerId: "A13V1IB3VIYZZH",
          },
          csv: Array.from({ length: 19 }, (_, index) => index === 18
            ? [
                8_000_000, 10_000,
                8_030_000, 10_500,
                8_060_000, 9_900,
                8_090_000, 10_200,
                8_120_000, 9_800,
                8_150_000, 10_100,
              ]
            : null),
        }],
      });
    },
  });

  const observations = await scanKeepaMarket(client, "FR", {
    fixture: true,
    categoryIds: [172282, 172282],
    minPriceCents: 10_000,
    maxPriceCents: 50_000,
    targetBrands: ["Apple", "Samsung"],
  });
  assert.deepEqual(paths, ["/deal", "/product"]);
  assert.equal(observations[0]?.offer.price.amountMinor, 5_000);
  assert.equal(observations[0]?.offer.shipping?.amountMinor, 0);
  assert.equal(observations[0]?.offer.total?.amountMinor, 5_000);
  assert.equal(observations[0]?.offer.sellerTrusted, true);
  assert.equal(observations[0]?.offer.referencePrice?.amountMinor, 10_000);
  assert.equal(observations[0]?.offer.referencePriceSource, "keepa_average");
  assert.equal(observations[0]?.offer.fixture, true);
  assert.equal(observations[0]?.historicalPrices?.length, 6);
  assert.deepEqual(
    observations[0]?.historicalPrices?.map((point) => point.priceMinor),
    [10_100, 9_800, 10_200, 9_900, 10_500, 10_000],
  );
  assert.equal(client.quota.tokensLeft, 10);
  assert.deepEqual(dealSelection.includeCategories, [172282]);
  assert.deepEqual(dealSelection.excludeCategories, [468256, 69_633_011, 672_109_031, 537366, 206_442_031, 578608]);
  assert.deepEqual(dealSelection.priceTypes, [18]);
  assert.deepEqual(dealSelection.deltaPercentRange, [30, 100]);
  assert.equal(dealSelection.deltaRange, undefined);
  assert.equal(dealSelection.isRangeEnabled, true);
  assert.equal(dealSelection.dateRange, 0);
  assert.deepEqual(dealSelection.currentRange, [10_000, 50_000]);
  assert.deepEqual(dealSelection.brand, ["Apple", "Samsung"]);

  const keepa = observations[0];
  assert.ok(keepa);
  const live = structuredClone(keepa);
  live.offer.product.productKey = "amazon:fr:live-page";
  live.offer.shipping = { amountMinor: 0, currency: "EUR" };
  live.offer.total = { amountMinor: 5_000, currency: "EUR" };
  live.offer.strategy = "connector";
  live.offer.referencePrice = { amountMinor: 8_000, currency: "EUR" };
  live.offer.referencePriceSource = "merchant_page";
  const merged = mergeKeepaWithLive(keepa, live);
  assert.equal(merged.verification.status, "confirmed");
  assert.equal(merged.offer.shipping?.amountMinor, 0);
  assert.equal(merged.offer.referencePrice?.amountMinor, 8_000);
  assert.equal(merged.offer.referencePriceSource, "merchant_page");
  assert.equal(merged.historicalPrices?.length, 6);
});

test("le ciblage Amazon accepte uniquement les marques Apple et Samsung", () => {
  assert.equal(isTargetAmazonBrand("Apple"), true);
  assert.equal(isTargetAmazonBrand("Samsung Electronics"), true);
  assert.equal(isTargetAmazonBrand("Coque compatible Apple"), false);
  assert.equal(isTargetAmazonBrand("Generic"), false);
  assert.equal(isTargetAmazonBrand(null), false);
});

test("exclut par défaut les livres, la musique, les vidéos et l'art mural des résultats Amazon", () => {
  assert.equal(isExcludedAmazonProduct({ title: "Roman", categoryPath: ["Livres"], productGroup: "Book" }, ["books"]), true);
  assert.equal(isExcludedAmazonProduct({ title: "Album", categoryPath: ["CD et Vinyles"], productGroup: "Music" }, ["music"]), true);
  assert.equal(isExcludedAmazonProduct({ title: "Décoration", categoryPath: ["Décoration murale", "Tableaux"], productGroup: "Home" }, ["wall_art"]), true);
  assert.equal(isExcludedAmazonProduct({ title: "Avengers Blu-ray", categoryPath: ["Films", "DVD et Blu-ray"], productGroup: "Video" }, ["media"]), true);
  assert.equal(isExcludedAmazonProduct({ title: "Casque audio", categoryPath: ["High-Tech", "Audio"], productGroup: "Electronics" }, ["books", "music", "media", "wall_art"]), false);
});

test("résout un EAN en ASIN avec le paramètre Keepa code et conserve le GTIN", async () => {
  const client = new KeepaClient({
    apiKey: "KEEPA_SECRET_TEST",
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/product");
      assert.equal(url.searchParams.get("domain"), "4");
      assert.equal(url.searchParams.get("code"), "4006381333931");
      assert.equal(url.searchParams.get("asin"), null);
      return Response.json({
        tokensLeft: 8,
        products: [{
          asin: "B012345678",
          title: "Produit trouvé par EAN",
          eanList: ["4006381333931"],
          brand: "Fixture",
          stats: {
            current: [4_990, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 4_990],
            avg90: [7_990],
            buyBoxIsAmazon: true,
            buyBoxIsFBA: true,
            buyBoxSellerId: "A13V1IB3VIYZZH",
          },
          csv: [[8_000_000, 7_990]],
        }],
      });
    },
  });
  const products = await client.productsByCodes("FR", ["4006381333931"]);
  assert.equal(products.length, 1);
  assert.equal(products[0]?.asin, "B012345678");
  assert.equal(products[0]?.gtin, "4006381333931");
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

test("attend puis retente une fois lorsque Keepa renvoie un quota 429", async () => {
  let calls = 0;
  const waits: number[] = [];
  const client = new KeepaClient({
    apiKey: "KEEPA_SECRET_TEST",
    maxQuotaWaitMs: 2_000,
    sleep: async (milliseconds) => { waits.push(milliseconds); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, { status: 429, headers: { "retry-after": "1" } });
      }
      return Response.json({ tokensLeft: 10, refillIn: 1_000, refillRate: 5, deals: { dr: [] } });
    },
  });

  assert.deepEqual(await client.deals("FR"), []);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [1_025]);
});
