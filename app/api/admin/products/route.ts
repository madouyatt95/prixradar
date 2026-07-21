import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { alerts, canonicalProducts, merchantProducts } from "@/db/schema";
import { adminJson, authorizeAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

function bodyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  try {
    const database = getDb();
    const [canonicalCount, mappingCount, pending] = await Promise.all([
      database.select({ count: sql<number>`count(*)` }).from(canonicalProducts),
      database.select({ count: sql<number>`count(*)` }).from(merchantProducts),
      database.select({
        id: merchantProducts.id,
        canonicalProductId: merchantProducts.canonicalProductId,
        source: merchantProducts.source,
        market: merchantProducts.market,
        externalId: merchantProducts.externalId,
        title: merchantProducts.title,
        brand: merchantProducts.brand,
        model: merchantProducts.model,
        gtin: merchantProducts.gtin,
        matchMethod: merchantProducts.matchMethod,
        matchScore: merchantProducts.matchScore,
        lastSeenAt: merchantProducts.lastSeenAt,
      }).from(merchantProducts)
        .where(eq(merchantProducts.reviewStatus, "needs_review"))
        .orderBy(desc(merchantProducts.updatedAt))
        .limit(50),
    ]);
    return adminJson({
      ok: true,
      metrics: {
        canonicalProducts: Number(canonicalCount[0]?.count ?? 0),
        merchantMappings: Number(mappingCount[0]?.count ?? 0),
        pendingReviews: pending.length,
      },
      pending,
    });
  } catch {
    return adminJson({ ok: false, code: "PRODUCT_GRAPH_UNAVAILABLE", error: "Le référentiel produit est indisponible." }, 503);
  }
}

export async function PATCH(request: Request) {
  const authorization = await authorizeAdmin(request);
  if (!authorization.ok) return authorization.response;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return adminJson({ ok: false, error: "Corps JSON invalide." }, 400);
  }
  if (!bodyRecord(raw) || typeof raw.id !== "string" || !["confirm", "reject", "merge"].includes(String(raw.action))) {
    return adminJson({ ok: false, error: "Décision de rapprochement invalide." }, 400);
  }
  try {
    const database = getDb();
    const [mapping] = await database.select().from(merchantProducts).where(eq(merchantProducts.id, raw.id)).limit(1);
    if (!mapping) return adminJson({ ok: false, error: "Rapprochement introuvable." }, 404);
    const now = new Date().toISOString();
    if (raw.action === "reject") {
      await database.batch([
        database.update(merchantProducts).set({
          canonicalProductId: null,
          matchMethod: "manual",
          matchScore: 0,
          reviewStatus: "rejected",
          updatedAt: now,
        }).where(eq(merchantProducts.id, mapping.id)),
        database.update(alerts).set({ canonicalProductId: null, updatedAt: now }).where(and(
          eq(alerts.source, mapping.source),
          eq(alerts.market, mapping.market),
          eq(alerts.productId, mapping.externalId),
        )),
      ]);
      return adminJson({ ok: true, decision: "rejected" });
    }
    const canonicalProductId = raw.action === "merge" && typeof raw.canonicalProductId === "string"
      ? raw.canonicalProductId.trim()
      : mapping.canonicalProductId;
    if (!canonicalProductId) return adminJson({ ok: false, error: "Produit canonique manquant." }, 400);
    const [canonical] = await database.select().from(canonicalProducts)
      .where(eq(canonicalProducts.id, canonicalProductId)).limit(1);
    if (!canonical) return adminJson({ ok: false, error: "Produit canonique introuvable." }, 404);
    await database.batch([
      database.update(merchantProducts).set({
        canonicalProductId,
        matchMethod: raw.action === "merge" ? "manual" : mapping.matchMethod,
        matchScore: raw.action === "merge" ? 100 : Math.max(80, mapping.matchScore),
        reviewStatus: "confirmed",
        updatedAt: now,
      }).where(eq(merchantProducts.id, mapping.id)),
      database.update(canonicalProducts).set({
        reviewStatus: "confirmed",
        matchConfidence: Math.max(80, canonical.matchConfidence),
        updatedAt: now,
      }).where(eq(canonicalProducts.id, canonicalProductId)),
      database.update(alerts).set({ canonicalProductId, updatedAt: now }).where(and(
        eq(alerts.source, mapping.source),
        eq(alerts.market, mapping.market),
        eq(alerts.productId, mapping.externalId),
      )),
    ]);
    return adminJson({ ok: true, decision: "confirmed", canonicalProductId });
  } catch {
    return adminJson({ ok: false, error: "Décision impossible." }, 500);
  }
}
