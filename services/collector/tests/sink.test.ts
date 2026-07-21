import assert from "node:assert/strict";
import test from "node:test";

import { ingestIdempotencyKey, postObservation, toAlertIngestEnvelope } from "../src/sink.js";
import type { VerifiedObservation } from "../src/types.js";

function observation(fixture = false): VerifiedObservation {
  return {
    schemaVersion: "1",
    alertCandidateId: "boulanger:fr:123",
    offer: {
      product: {
        productKey: "boulanger:fr:123",
        source: "boulanger",
        market: "FR",
        externalId: "123",
        title: "Produit de test",
        brand: null,
        model: null,
        gtin: null,
        url: "https://www.boulanger.com/ref/123",
        imageUrl: null,
      },
      price: { amountMinor: 9_999, currency: "EUR" },
      shipping: null,
      total: null,
      referencePrice: { amountMinor: 19_999, currency: "EUR" },
      seller: "Boulanger",
      sellerTrusted: true,
      condition: "new",
      availability: "in_stock",
      observedAt: "2026-07-21T10:00:00.000Z",
      strategy: "json-ld",
      fixture,
    },
    verification: {
      status: "confirmed",
      firstObservedAt: "2026-07-21T09:59:55.000Z",
      secondObservedAt: "2026-07-21T10:00:00.000Z",
      matchingPrice: true,
      matchingIdentity: true,
    },
    anomaly: { score: 90, classification: "strong", discountPercent: 50, reasons: ["fixture test"] },
  };
}

test("utilise deux authentifications privées et une clé d’idempotence stable", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return Response.json({ ok: true, accepted: true, alert: { id: "boulanger:fr:123", score: 80, notificationEligible: true } });
  };
  const item = observation();
  await postObservation(item, {
    baseUrl: "https://prixradar.example/private/path",
    ingestSecret: "ingest-secret-test",
    sitesAuthToken: "sites-secret-test",
  }, fakeFetch);

  assert.equal(calls[0]?.url, "https://prixradar.example/api/ingest");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer ingest-secret-test");
  assert.equal(headers.get("oai-sites-authorization"), "Bearer sites-secret-test");
  assert.equal(headers.get("idempotency-key"), ingestIdempotencyKey(item));
  assert.equal(ingestIdempotencyKey(item), ingestIdempotencyKey(structuredClone(item)));
  const envelope = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(envelope).sort(), ["eventType", "idempotencyKey", "payload", "source"]);
  assert.equal(envelope.eventType, "alert_upsert");
  const payload = envelope.payload as Record<string, unknown>;
  assert.equal(payload.id, "boulanger:fr:123");
  assert.equal(payload.shippingCents, null);
  assert.equal(payload.sourceMode, "live");
  assert.equal(payload.verificationCount, 2);
});

test("une fixture ne peut jamais atteindre le réseau", async () => {
  let called = false;
  await assert.rejects(
    postObservation(observation(true), {
      baseUrl: "https://prixradar.example",
      ingestSecret: "never-used-secret",
    }, async () => {
      called = true;
      return Response.json({ ok: true });
    }),
    /fixture/u,
  );
  assert.equal(called, false);
});

test("transmet l’historique Keepa uniquement avec une livraison explicitement gratuite", () => {
  const item = observation();
  item.offer.product.source = "amazon";
  item.offer.product.market = "FR";
  item.offer.product.externalId = "B012345678";
  item.offer.product.url = "https://www.amazon.fr/dp/B012345678";
  item.offer.shipping = { amountMinor: 0, currency: "EUR" };
  item.offer.total = { amountMinor: item.offer.price.amountMinor, currency: "EUR" };
  item.historicalPrices = [{
    provider: "keepa",
    priceMinor: 19_999,
    observedAt: "2026-07-01T10:00:00.000Z",
    rawHash: "a".repeat(64),
  }];
  const envelope = toAlertIngestEnvelope(item);
  assert.equal(envelope.payload.historicalPrices?.length, 1);
  item.offer.shipping = null;
  item.offer.total = null;
  assert.equal(toAlertIngestEnvelope(item).payload.historicalPrices, undefined);
});

test("les erreurs publiques ne contiennent aucun secret", async () => {
  const ingestSecret = "TOP_SECRET_INGEST_VALUE";
  const sitesSecret = "TOP_SECRET_SITES_VALUE";
  await assert.rejects(
    postObservation(observation(), {
      baseUrl: "https://prixradar.example",
      ingestSecret,
      sitesAuthToken: sitesSecret,
    }, async () => new Response("upstream body with details", { status: 503 })),
    (error: unknown) => {
      const rendered = String(error);
      assert.equal(rendered.includes(ingestSecret), false);
      assert.equal(rendered.includes(sitesSecret), false);
      assert.equal(rendered.includes("upstream body"), false);
      return true;
    },
  );
});
