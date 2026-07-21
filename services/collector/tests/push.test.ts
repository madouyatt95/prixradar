import assert from "node:assert/strict";
import test from "node:test";

import { sendPushForObservation } from "../src/push.js";
import type { VerifiedObservation } from "../src/types.js";

function alert(fixture = false): VerifiedObservation {
  return {
    schemaVersion: "1",
    alertCandidateId: "amazon:fr:B012345678",
    offer: {
      product: {
        productKey: "amazon:fr:B012345678",
        source: "amazon",
        market: "FR",
        externalId: "B012345678",
        title: "Produit Fixture",
        brand: null,
        model: "MODEL",
        gtin: null,
        url: "https://www.amazon.fr/dp/B012345678",
        imageUrl: null,
      },
      variantIdentity: {
        expectedId: "asin:b012345678",
        observedId: "asin:b012345678",
        expectedSource: "keepa_deal",
        observedSource: "keepa_product",
        merchantProductId: "b012345678",
        gtin: null,
        selectedOptions: {},
      },
      price: { amountMinor: 5_000, currency: "EUR" },
      shipping: { amountMinor: 0, currency: "EUR" },
      total: { amountMinor: 5_000, currency: "EUR" },
      referencePrice: { amountMinor: 10_000, currency: "EUR" },
      seller: "Amazon",
      sellerTrusted: true,
      condition: "new",
      availability: "in_stock",
      observedAt: "2026-07-21T10:00:00.000Z",
      strategy: "keepa",
      fixture,
      cartProbe: {
        status: "confirmed",
        itemCents: 5_000,
        shippingCents: 0,
        totalCents: 5_000,
        stockConfirmed: true,
        addToCartAvailable: true,
        identityConfirmed: true,
        explicitShipping: true,
        explicitTotal: true,
        couponApplied: true,
        checkedAt: "2026-07-21T10:00:00.000Z",
      },
    },
    verification: {
      status: "confirmed",
      firstObservedAt: "2026-07-21T09:59:00.000Z",
      secondObservedAt: "2026-07-21T10:00:00.000Z",
      matchingIdentity: true,
      matchingPrice: true,
    },
    anomaly: { score: 90, classification: "strong", discountPercent: 50, reasons: [] },
    historicalPrices: [{
      provider: "keepa",
      priceMinor: 10_000,
      observedAt: "2026-07-20T10:00:00.000Z",
      rawHash: "a".repeat(64),
    }],
  };
}

const config = {
  baseUrl: "https://prixradar.example",
  deliverySecret: "PUSH_SECRET_TEST",
  sitesAuthToken: "SITES_SECRET_TEST",
  vapidSubject: "mailto:test@example.com",
  vapidPublicKey: "PUBLIC_TEST_KEY",
  vapidPrivateKey: "PRIVATE_TEST_KEY",
};

test("une fixture ne récupère aucune cible et n’envoie rien", async () => {
  let calls = 0;
  const summary = await sendPushForObservation("alert-1", 90, alert(true), config, {
    fetchImpl: async () => { calls += 1; return Response.json({ ok: true }); },
    sendNotification: async () => { calls += 1; return { statusCode: 201, headers: {}, body: "" }; },
  });
  assert.equal(summary.eligible, false);
  assert.equal(calls, 0);
});

test("réserve puis complète chaque livraison avec le secret push distinct", async () => {
  const actions: unknown[] = [];
  const auth: string[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    auth.push(new Headers(init?.headers).get("authorization") ?? "");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    if (body) actions.push(body);
    if (url.pathname === "/api/push/targets") {
      assert.equal(init?.method, "GET");
      assert.equal(url.searchParams.get("score"), "90");
      assert.equal(url.searchParams.get("tier"), "urgent");
      assert.equal(url.searchParams.get("sellerScore"), "100");
      assert.equal(url.searchParams.get("exactVariantConfirmed"), "true");
      assert.equal(url.searchParams.get("cartConfirmed"), "true");
      assert.equal(url.searchParams.get("historyPoints"), "1");
      assert.ok(Number(url.searchParams.get("verifiedAgeMinutes")) >= 0);
      return Response.json({ ok: true, targets: [{
        id: 1,
        endpoint: "https://push.example/subscription-1",
        keys: { p256dh: "p256dh", auth: "auth" },
        contentEncoding: "aes128gcm",
        minScore: 60,
        tier: "urgent",
      }], nextAfter: null });
    }
    if (body?.action === "reserve") return Response.json({ ok: true, reserved: true, reservationId: 1 });
    return Response.json({ ok: true, reserved: false });
  };
  const summary = await sendPushForObservation("alert-1", 90, alert(), config, {
    fetchImpl: fakeFetch,
    sendNotification: async () => ({ statusCode: 201, headers: {}, body: "" }),
  });
  assert.deepEqual(summary, { eligible: true, targets: 1, reserved: 1, sent: 1, failed: 0 });
  assert.deepEqual(actions, [
    { action: "reserve", alertId: "alert-1", subscriptionId: 1, tier: "urgent" },
    { action: "complete", reservationId: 1, status: "sent" },
  ]);
  assert.ok(auth.every((value) => value === "Bearer PUSH_SECRET_TEST"));
});
