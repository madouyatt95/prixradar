import assert from "node:assert/strict";
import test from "node:test";

import { ingestIdempotencyKey, postObservation, postSignalObservation, postSocialPublications, recentSocialPublicationIds, toAlertIngestEnvelope } from "../src/sink.js";
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
      variantIdentity: {
        expectedId: "sku:123",
        observedId: "sku:123",
        expectedSource: "request_url",
        observedSource: "merchant_dom",
        merchantProductId: "123",
        gtin: null,
        selectedOptions: {},
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
  assert.equal(payload.expectedVariantId, "sku:123");
  assert.equal(payload.observedVariantId, "sku:123");
});

test("un ancien snapshot n'obtient jamais deux identifiants de variante égaux par défaut", () => {
  const item = observation();
  delete item.offer.variantIdentity;
  const payload = toAlertIngestEnvelope(item).payload;
  assert.equal(payload.expectedVariantId, null);
  assert.equal(payload.observedVariantId, null);
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

test("un signal à une vérification peut demander une notification sans horodatage certifié", async () => {
  const item = observation();
  item.verification.status = "rejected";
  item.verification.matchingPrice = false;
  let payload: Record<string, unknown> | null = null;
  await postSignalObservation(item, {
    baseUrl: "https://prixradar.example",
    ingestSecret: "signal-secret-test",
    requestNotification: true,
  }, async (_input, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ ok: true, accepted: true, alert: { id: item.alertCandidateId, score: 40, notificationEligible: false } });
  });
  const body = payload?.payload as Record<string, unknown>;
  assert.equal(body.verificationCount, 1);
  assert.equal(body.verifiedAt, null);
  assert.equal(body.notify, true);
});

test("transmet l’historique Keepa uniquement avec un prix livré sans frais résiduels", () => {
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

test("la livraison Facebook conserve six heures pour rattraper les e-mails retardés", async () => {
  const now = Date.now();
  let authorization = "";
  const offsets: number[] = [];
  const ids = await recentSocialPublicationIds({
    baseUrl: "https://prixradar.example",
    ingestSecret: "social-ingest-secret-test",
  }, async (input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    const offset = Number(new URL(String(input)).searchParams.get("offset") ?? "0");
    offsets.push(offset);
    return Response.json({
      ok: true,
      items: [
        { id: "facebook:848306336465354:123456789", publishedAt: new Date(now - 5 * 60_000).toISOString() },
        { id: "facebook:848306336465354:123456789", publishedAt: new Date(now - 4 * 60_000).toISOString() },
        { id: "facebook:584379244259839:987654321", publishedAt: new Date(now - 16 * 60_000).toISOString() },
        { id: "facebook:584379244259839:111111111", publishedAt: new Date(now - 7 * 60 * 60_000).toISOString() },
        { id: "x:dealabs:123456789", publishedAt: new Date(now - 2 * 60_000).toISOString() },
      ],
    });
  });
  assert.equal(authorization, "Bearer social-ingest-secret-test");
  assert.deepEqual(ids, [
    "facebook:848306336465354:123456789",
    "facebook:584379244259839:987654321",
  ]);
  assert.deepEqual(offsets, [0]);
});

test("la livraison Facebook pagine au-delà de quarante publications", async () => {
  const now = Date.now();
  const offsets: number[] = [];
  const ids = await recentSocialPublicationIds({
    baseUrl: "https://prixradar.example",
    ingestSecret: "social-ingest-secret-test",
  }, async (input) => {
    const offset = Number(new URL(String(input)).searchParams.get("offset") ?? "0");
    offsets.push(offset);
    if (offset === 0) {
      return Response.json({
        ok: true,
        items: Array.from({ length: 60 }, (_value, index) => ({
          id: `facebook:848306336465354:${String(index + 1).padStart(3, "0")}`,
          publishedAt: new Date(now - index * 1_000).toISOString(),
        })),
      });
    }
    return Response.json({
      ok: true,
      items: [{
        id: "facebook:584379244259839:061",
        publishedAt: new Date(now - 61_000).toISOString(),
      }],
    });
  });
  assert.deepEqual(offsets, [0, 60]);
  assert.equal(ids.length, 61);
  assert.ok(ids.includes("facebook:584379244259839:061"));
});

test("l’ingestion sociale laisse l’API centrale décider d’un unique dispatch", async () => {
  let body: Record<string, unknown> = {};
  const response = await postSocialPublications({
    sourceId: "facebook:848306336465354",
    scannedAt: new Date().toISOString(),
    successful: true,
    notify: false,
    items: [],
  }, {
    baseUrl: "https://prixradar.example",
    ingestSecret: "social-ingest-secret-test",
  }, async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      ok: true,
      accepted: 0,
      newItems: [],
      notificationDispatch: { requested: false, started: false },
    });
  });
  assert.equal(body.notify, false);
  assert.deepEqual(response.notificationDispatch, { requested: false, started: false });
});
