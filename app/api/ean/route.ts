import { and, desc, eq, or } from "drizzle-orm";

import { getDb } from "@/db";
import {
  alerts,
  canonicalProducts,
  eanScanRequests,
  merchantProducts,
  missionItems,
  radarRules,
} from "@/db/schema";
import { normalizeGtin } from "@/lib/product-identity";
import {
  deviceDatabaseError,
  deviceError,
  deviceJson,
  readJsonObject,
  resolveDevice,
} from "../push/device";

export const dynamic = "force-dynamic";

const FRESH_OFFER_MS = 24 * 60 * 60_000;

type ScanRow = typeof eanScanRequests.$inferSelect;
type AlertRow = typeof alerts.$inferSelect;

function parseNotificationEligibility(value: string) {
  try {
    const parsed = JSON.parse(value) as { notificationEligible?: unknown };
    return parsed?.notificationEligible === true;
  } catch {
    return false;
  }
}

function actionable(row: AlertRow, now: number) {
  return row.sourceMode === "live"
    && row.status === "active"
    && row.verifiedAt !== null
    && row.expiresAt !== null
    && Date.parse(row.expiresAt) > now
    && Date.parse(row.observedAt) >= now - 120 * 60_000
    && row.shippingCents !== null
    && row.priceAccessibleToAll
    && row.score >= 65
    && (row.confidence === "very_likely" || row.confidence === "likely")
    && parseNotificationEligibility(row.evidenceJson);
}

function offer(row: AlertRow, isActionable: boolean) {
  return {
    alertId: row.id,
    source: row.source,
    merchant: row.merchant,
    market: row.market,
    title: row.title,
    url: row.url,
    currency: row.currency,
    priceCents: row.priceCents,
    shippingCents: row.shippingCents,
    totalCents: row.shippingCents === null ? null : row.priceCents + row.shippingCents,
    usualPriceCents: row.usualPriceCents,
    discountPercent: row.discountPercent,
    score: row.score,
    confidence: row.confidence,
    status: row.status,
    actionable: isActionable,
    observedAt: row.observedAt,
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
  };
}

async function detection(row: ScanRow) {
  const database = getDb();
  const [canonical] = await database.select().from(canonicalProducts)
    .where(eq(canonicalProducts.gtinKey, row.gtin)).limit(1);
  const productConditions = canonical
    ? or(eq(merchantProducts.gtin, row.gtin), eq(merchantProducts.canonicalProductId, canonical.id))
    : eq(merchantProducts.gtin, row.gtin);
  const alertConditions = canonical
    ? or(eq(alerts.gtin, row.gtin), eq(alerts.canonicalProductId, canonical.id))
    : eq(alerts.gtin, row.gtin);
  const [products, alertRows] = await Promise.all([
    database.select().from(merchantProducts).where(productConditions)
      .orderBy(desc(merchantProducts.lastSeenAt)).limit(30),
    database.select().from(alerts).where(alertConditions)
      .orderBy(desc(alerts.observedAt)).limit(30),
  ]);
  const now = Date.now();
  const uniqueOffers = [...new Map(alertRows.map((item) => [`${item.source}:${item.market}`, item])).values()];
  const evaluated = uniqueOffers.map((item) => ({ item, actionable: actionable(item, now) }))
    .sort((left, right) => Number(right.actionable) - Number(left.actionable)
      || right.item.score - left.item.score
      || Date.parse(right.item.observedAt) - Date.parse(left.item.observedAt));
  const lead = evaluated[0] ?? null;
  const anomaly = evaluated.find((item) => item.actionable) ?? null;
  const recentOffer = evaluated.find((item) => item.item.sourceMode === "live"
    && Date.parse(item.item.observedAt) >= now - FRESH_OFFER_MS) ?? null;
  const product = canonical ?? products[0] ?? null;
  const verdict = anomaly ? "anomaly" as const : product && recentOffer ? "normal" as const : "monitoring" as const;
  const sourceKeys = [...new Set(products.map((item) => `${item.source}:${item.market}`))];

  return {
    ok: true,
    verdict,
    message: anomaly
      ? `Prix anormal confirmé chez ${anomaly.item.merchant}.`
      : verdict === "normal"
        ? "Produit reconnu. Aucun écart de prix suffisamment solide n’est confirmé pour le moment."
        : "Recherche prioritaire lancée sur Amazon Europe et les enseignes surveillées.",
    item: {
      id: row.id,
      gtin: row.gtin,
      status: anomaly || product ? "matched" : row.status,
      monitoring: true,
      radarRuleId: row.radarRuleId,
      requestedAt: row.requestedAt,
      lastCheckedAt: row.lastCheckedAt,
      nextCheckAt: row.nextCheckAt,
    },
    product: product ? {
      canonicalProductId: canonical?.id ?? products[0]?.canonicalProductId ?? null,
      gtin: row.gtin,
      title: product.title,
      brand: product.brand,
      model: product.model,
      category: "category" in product ? product.category : null,
      merchantCount: sourceKeys.length,
      sources: sourceKeys,
    } : null,
    bestOffer: lead ? offer(lead.item, lead.actionable) : null,
    offers: evaluated.slice(0, 12).map((entry) => offer(entry.item, entry.actionable)),
    coverage: {
      amazonMarkets: ["FR", "DE", "IT", "ES", "GB"],
      merchantMatches: products.length,
      offersCompared: evaluated.length,
    },
  };
}

async function scanForOwner(ownerId: string, id: string | null, gtin: string | null) {
  const conditions = [eq(eanScanRequests.ownerId, ownerId)];
  if (id) conditions.push(eq(eanScanRequests.id, id));
  if (gtin) conditions.push(eq(eanScanRequests.gtin, gtin));
  const [row] = await getDb().select().from(eanScanRequests)
    .where(and(...conditions)).orderBy(desc(eanScanRequests.updatedAt)).limit(1);
  return row ?? null;
}

export async function GET(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const search = new URL(request.url).searchParams;
  const id = search.get("id")?.trim() ?? "";
  const rawCode = search.get("code")?.trim() ?? "";
  const gtin = rawCode ? normalizeGtin(rawCode) : null;
  if ((!id && !gtin) || (id && !/^ean:[0-9a-f-]{36}$/u.test(id)) || (rawCode && !gtin)) {
    return deviceError(identity.device, 400, "invalid_ean_scan", "Indiquez un scan ou un EAN valide.");
  }
  try {
    const row = await scanForOwner(identity.device.ownerId, id || null, gtin);
    if (!row) return deviceError(identity.device, 404, "ean_scan_not_found", "Cette recherche EAN n’existe pas sur cet appareil.");
    const payload = await detection(row);
    const matchedAlertId = payload.bestOffer?.alertId ?? null;
    const canonicalProductId = payload.product?.canonicalProductId ?? null;
    if (payload.verdict !== "monitoring" || row.canonicalProductId !== canonicalProductId || row.matchedAlertId !== matchedAlertId) {
      await getDb().update(eanScanRequests).set({
        status: payload.verdict === "monitoring" ? row.status : "matched",
        canonicalProductId,
        matchedAlertId,
        updatedAt: new Date().toISOString(),
      }).where(eq(eanScanRequests.id, row.id));
    }
    return deviceJson(identity.device, payload);
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveDevice(request);
  if (!identity.ok) return identity.response;
  const body = await readJsonObject(request);
  const gtin = normalizeGtin(typeof body?.code === "string" ? body.code : null);
  if (!gtin) {
    return deviceError(identity.device, 400, "invalid_ean", "Le code-barres est invalide ou sa clé de contrôle ne correspond pas.");
  }
  try {
    const database = getDb();
    const existing = await scanForOwner(identity.device.ownerId, null, gtin);
    const now = new Date().toISOString();
    const intent = {
      keywords: [],
      brands: [],
      categories: [],
      markets: [],
      maxPriceCents: null,
      minDiscount: null,
      condition: null,
      accessibleToAll: false,
      deliveryCountry: null,
      gtins: [gtin],
    };
    let row: ScanRow;
    if (existing) {
      await database.update(eanScanRequests).set({
        status: "queued",
        claimedAt: null,
        requestedAt: now,
        nextCheckAt: now,
        updatedAt: now,
      }).where(eq(eanScanRequests.id, existing.id));
      const [restoredRule] = existing.radarRuleId
        ? await database.update(radarRules).set({ enabled: true, status: "active", updatedAt: now })
          .where(and(eq(radarRules.id, existing.radarRuleId), eq(radarRules.ownerId, identity.device.ownerId)))
          .returning({ id: radarRules.id })
        : [];
      let radarRuleId = restoredRule?.id ?? null;
      if (!radarRuleId) {
        radarRuleId = `radar:${crypto.randomUUID()}`;
        await database.batch([
          database.insert(radarRules).values({
            id: radarRuleId,
            ownerId: identity.device.ownerId,
            name: `EAN ${gtin}`,
            query: `Produit EAN ${gtin}`,
            intentJson: JSON.stringify(intent),
            kind: "single",
            status: "active",
            enabled: true,
            createdAt: now,
            updatedAt: now,
          }),
          database.insert(missionItems).values({
            id: `mission-item:${crypto.randomUUID()}`,
            missionId: radarRuleId,
            ownerId: identity.device.ownerId,
            label: `Produit EAN ${gtin}`,
            query: `Produit EAN ${gtin}`,
            intentJson: JSON.stringify(intent),
            createdAt: now,
            updatedAt: now,
          }),
          database.update(eanScanRequests).set({ radarRuleId, updatedAt: now })
            .where(eq(eanScanRequests.id, existing.id)),
        ]);
      }
      row = { ...existing, status: "queued", radarRuleId, claimedAt: null, requestedAt: now, nextCheckAt: now, updatedAt: now };
    } else {
      const id = `ean:${crypto.randomUUID()}`;
      const radarRuleId = `radar:${crypto.randomUUID()}`;
      await database.batch([
        database.insert(radarRules).values({
          id: radarRuleId,
          ownerId: identity.device.ownerId,
          name: `EAN ${gtin}`,
          query: `Produit EAN ${gtin}`,
          intentJson: JSON.stringify(intent),
          kind: "single",
          status: "active",
          enabled: true,
          createdAt: now,
          updatedAt: now,
        }),
        database.insert(missionItems).values({
          id: `mission-item:${crypto.randomUUID()}`,
          missionId: radarRuleId,
          ownerId: identity.device.ownerId,
          label: `Produit EAN ${gtin}`,
          query: `Produit EAN ${gtin}`,
          intentJson: JSON.stringify(intent),
          createdAt: now,
          updatedAt: now,
        }),
        database.insert(eanScanRequests).values({
          id,
          ownerId: identity.device.ownerId,
          gtin,
          status: "queued",
          radarRuleId,
          resultJson: JSON.stringify({ trigger: "camera_or_manual", amazonMarkets: ["FR", "DE", "IT", "ES", "GB"] }),
          requestedAt: now,
          nextCheckAt: now,
          updatedAt: now,
        }),
      ]);
      row = {
        id,
        ownerId: identity.device.ownerId,
        gtin,
        status: "queued",
        radarRuleId,
        canonicalProductId: null,
        matchedAlertId: null,
        resultJson: "{}",
        requestedAt: now,
        claimedAt: null,
        lastCheckedAt: null,
        nextCheckAt: now,
        updatedAt: now,
      };
    }
    return deviceJson(identity.device, await detection(row), { status: 202 });
  } catch (error) {
    return deviceDatabaseError(identity.device, error);
  }
}
