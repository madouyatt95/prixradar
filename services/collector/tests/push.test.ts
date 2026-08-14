import assert from "node:assert/strict";
import test from "node:test";

import { sendProtectionPush, sendPushForObservation, sendSocialPublicationPush } from "../src/push.js";
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

test("confirme une notification sociale avec le bail exact reçu", async () => {
  const attemptId = "12345678-1234-4123-8123-123456789abc";
  const completions: unknown[] = [];
  const summary = await sendSocialPublicationPush(
    "facebook:848306336465354:123456789",
    config,
    {
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === "GET") {
          assert.equal(url.searchParams.get("publicationId"), "facebook:848306336465354:123456789");
          return Response.json({ ok: true, targets: [{
            notificationId: 9,
            attemptId,
            publicationId: "facebook:848306336465354:123456789",
            id: 3,
            endpoint: "https://push.example/facebook",
            keys: { p256dh: "p256dh", auth: "auth" },
            contentEncoding: "aes128gcm",
            title: "Facebook · Bons plans",
            body: "Nouvelle publication",
            url: "https://www.facebook.com/groups/848306336465354/posts/123456789/",
            imageUrl: null,
          }] });
        }
        completions.push(JSON.parse(String(init?.body)) as unknown);
        return Response.json({ ok: true });
      },
      sendNotification: async () => ({ statusCode: 201, headers: {}, body: "" }),
    },
  );
  assert.equal(summary.sent, 1);
  assert.deepEqual(completions, [{ notificationId: 9, attemptId, status: "sent" }]);
});

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
  const subscriptions: unknown[] = [];
  const notificationOptions: unknown[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    auth.push(new Headers(init?.headers).get("authorization") ?? "");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    if (body) actions.push(body);
    if (url.pathname === "/api/push/targets") {
      assert.equal(init?.method, "GET");
      assert.equal(url.searchParams.get("score"), "90");
      assert.equal(url.searchParams.get("tier"), "urgent");
      assert.equal(url.searchParams.get("alertLevel"), "reliable");
      assert.equal(url.searchParams.get("sellerScore"), "100");
      assert.equal(url.searchParams.get("exactVariantConfirmed"), "true");
      assert.equal(url.searchParams.get("cartConfirmed"), "true");
      assert.equal(url.searchParams.get("historyPoints"), "1");
      assert.ok(Number(url.searchParams.get("verifiedAgeMinutes")) >= 0);
      return Response.json({ ok: true, targets: [{
        id: 1,
        endpoint: "https://push.example/subscription-1",
        keys: { p256dh: "p256+dh/=", auth: "au+th/=" },
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
    sendNotification: async (subscription, _payload, options) => {
      subscriptions.push(subscription);
      notificationOptions.push(options);
      return { statusCode: 201, headers: {}, body: "" };
    },
  });
  assert.deepEqual(summary, { eligible: true, targets: 1, reserved: 1, sent: 1, failed: 0 });
  assert.deepEqual(actions, [
    { action: "reserve", alertId: "alert-1", subscriptionId: 1, tier: "urgent", alertLevel: "reliable" },
    { action: "complete", reservationId: 1, status: "sent" },
  ]);
  assert.ok(auth.every((value) => value === "Bearer PUSH_SECRET_TEST"));
  assert.deepEqual(subscriptions, [{
    endpoint: "https://push.example/subscription-1",
    keys: { p256dh: "p256-dh_", auth: "au-th_" },
  }]);
  assert.equal((notificationOptions[0] as { topic?: string }).topic, "alert-1");
});

test("normalise un identifiant d'alerte en topic Web Push sûr", async () => {
  let topic = "";
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    if (url.pathname === "/api/push/targets") {
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
  const summary = await sendPushForObservation("amazon:fr:B09XQN4TXR", 90, alert(), config, {
    fetchImpl: fakeFetch,
    sendNotification: async (_subscription, _payload, options) => {
      topic = String(options?.topic ?? "");
      return { statusCode: 201, headers: {}, body: "" };
    },
  });
  assert.equal(topic, "amazon-fr-B09XQN4TXR");
  assert.match(topic, /^[A-Za-z0-9_-]{1,32}$/u);
  assert.equal(summary.sent, 1);
});

test("envoie une baisse JD Sports à vérifier sans inventer les frais de livraison", async () => {
  const listing = alert();
  listing.alertCandidateId = "jd_sports:fr:19742720_jdsportsfr";
  listing.offer = {
    ...listing.offer,
    product: {
      ...listing.offer.product,
      productKey: listing.alertCandidateId,
      source: "jd_sports",
      externalId: "19742720_jdsportsfr",
      title: "New Balance 740 Enfant",
      url: "https://m.jdsports.fr/product/blanc-new-balance-740-enfant/19742720_jdsportsfr/",
    },
    variantIdentity: {
      expectedId: "sku:19742720_jdsportsfr",
      observedId: "sku:19742720_jdsportsfr",
      expectedSource: "listing_link",
      observedSource: "merchant_dom",
      merchantProductId: "19742720_jdsportsfr",
      gtin: null,
      selectedOptions: {},
    },
    price: { amountMinor: 5_500, currency: "EUR" },
    shipping: null,
    total: null,
    referencePrice: { amountMinor: 20_000, currency: "EUR" },
    seller: "JD Sports",
    sellerTrusted: true,
    verificationScope: "category_listing",
  };
  listing.anomaly = { score: 49, classification: "watch", discountPercent: 72.5, reasons: [] };
  listing.verification = {
    ...listing.verification,
    status: "observed",
    matchingPrice: false,
    secondObservedAt: listing.offer.observedAt,
  };
  const payloads: string[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    if (url.pathname === "/api/push/targets") {
      assert.equal(url.searchParams.get("alertLevel"), "watch");
      assert.equal(url.searchParams.get("discount"), "73");
      return Response.json({ ok: true, targets: [{
        id: 8,
        endpoint: "https://push.example/jd-listing",
        keys: { p256dh: "p256dh", auth: "auth" },
        contentEncoding: "aes128gcm",
        tier: "personal",
      }] });
    }
    if (body?.action === "reserve") return Response.json({ ok: true, reserved: true, reservationId: 8 });
    return Response.json({ ok: true });
  };
  const summary = await sendPushForObservation(listing.alertCandidateId, 39, listing, config, {
    fetchImpl: fakeFetch,
    sendNotification: async (_subscription, payload) => {
      payloads.push(String(payload));
      return { statusCode: 201, headers: {}, body: "" };
    },
  }, { alertLevel: "watch" });
  assert.equal(summary.sent, 1);
  assert.match(payloads[0] ?? "", /taille, stock et livraison à confirmer/u);
  assert.match(payloads[0] ?? "", /55\.00 EUR/u);
});

test("livre une baisse après achat uniquement à la réservation du propriétaire", async () => {
  const completions: unknown[] = [];
  const payloads: string[] = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer PUSH_SECRET_TEST");
    if (init?.method === "GET") {
      assert.equal(url.pathname, "/api/push/protection");
      assert.equal(url.searchParams.get("purchaseId"), "purchase:00000000-0000-4000-8000-000000000001");
      return Response.json({ ok: true, targets: [{
        notificationId: 7,
        purchaseId: "purchase:00000000-0000-4000-8000-000000000001",
        id: 3,
        endpoint: "https://push.example/protected-owner",
        keys: { p256dh: "p256dh", auth: "auth" },
        contentEncoding: "aes128gcm",
        title: "PrixRadar · baisse après votre achat",
        body: "80 € potentiellement récupérables",
        url: "/?tab=missions",
      }] });
    }
    completions.push(JSON.parse(String(init?.body)) as unknown);
    return Response.json({ ok: true });
  };
  const summary = await sendProtectionPush("purchase:00000000-0000-4000-8000-000000000001", config, {
    fetchImpl: fakeFetch,
    sendNotification: async (_subscription, payload) => {
      payloads.push(String(payload));
      return { statusCode: 201, headers: {}, body: "" };
    },
  });
  assert.deepEqual(summary, { eligible: true, targets: 1, reserved: 1, sent: 1, failed: 0 });
  assert.deepEqual(completions, [{ notificationId: 7, status: "sent" }]);
  assert.match(payloads[0], /"tier":"protection"/u);
});
