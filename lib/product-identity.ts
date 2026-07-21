import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { canonicalProducts, merchantProducts } from "@/db/schema";

type ProductIdentityInput = {
  source: string;
  market: string;
  externalId: string;
  identityKey: string | null;
  gtin: string | null;
  title: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  url: string;
  variantKey: string | null;
  observedAt: string;
};

export type CanonicalMatch = {
  canonicalProductId: string;
  merchantProductId: string;
  method: "gtin" | "brand_model" | "identity" | "isolated";
  score: number;
  reviewStatus: "automatic" | "needs_review";
  comparisonEligible: boolean;
};

function normalizedText(value: string | null, maximum = 160) {
  if (!value) return null;
  const normalized = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .slice(0, maximum);
  return normalized || null;
}

export function normalizeGtin(value: string | null) {
  const digits = value?.replace(/\D/gu, "") ?? "";
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(digits.at(-1)) ? digits : null;
}

async function stableId(prefix: string, value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}_${hex}`;
}

function matchIdentity(input: ProductIdentityInput) {
  const gtinKey = normalizeGtin(input.gtin);
  const brandKey = normalizedText(input.brand, 80);
  const modelKey = normalizedText(input.model, 120);
  const identityKey = normalizedText(input.identityKey, 180);
  if (gtinKey) return { key: `gtin:${gtinKey}`, gtinKey, brandKey, modelKey, method: "gtin" as const, score: 100 };
  if (brandKey && modelKey) return { key: `brand-model:${brandKey}:${modelKey}`, gtinKey, brandKey, modelKey, method: "brand_model" as const, score: 88 };
  if (identityKey) return { key: `identity:${identityKey}`, gtinKey, brandKey, modelKey, method: "identity" as const, score: 68 };
  return {
    key: `isolated:${input.source}:${input.market}:${input.externalId}`,
    gtinKey,
    brandKey,
    modelKey,
    method: "isolated" as const,
    score: 35,
  };
}

export async function resolveCanonicalProduct(input: ProductIdentityInput): Promise<CanonicalMatch> {
  const database = getDb();
  const existing = await database
    .select()
    .from(merchantProducts)
    .where(and(
      eq(merchantProducts.source, input.source),
      eq(merchantProducts.market, input.market),
      eq(merchantProducts.externalId, input.externalId),
    ))
    .limit(1);
  const current = existing[0];
  if (current?.reviewStatus === "rejected") {
    const isolatedId = await stableId("cp", `manual-isolated:${input.source}:${input.market}:${input.externalId}`);
    const now = new Date().toISOString();
    await database.batch([
      database.insert(canonicalProducts).values({
        id: isolatedId,
        gtinKey: null,
        title: input.title,
        brand: input.brand,
        brandKey: normalizedText(input.brand, 80),
        model: input.model,
        modelKey: normalizedText(input.model, 120),
        category: input.category,
        reviewStatus: "confirmed",
        matchConfidence: 100,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: canonicalProducts.id,
        set: { title: input.title, brand: input.brand, model: input.model, category: input.category, updatedAt: now },
      }),
      database.update(merchantProducts).set({
        canonicalProductId: isolatedId,
        title: input.title,
        brand: input.brand,
        model: input.model,
        url: input.url,
        variantKey: input.variantKey,
        matchMethod: "manual",
        matchScore: 100,
        reviewStatus: "confirmed",
        lastSeenAt: input.observedAt,
        updatedAt: now,
      }).where(eq(merchantProducts.id, current.id)),
    ]);
    return {
      canonicalProductId: isolatedId,
      merchantProductId: current.id,
      method: "isolated",
      score: 100,
      reviewStatus: "automatic",
      comparisonEligible: true,
    };
  }
  if (current?.canonicalProductId && current.reviewStatus !== "rejected") {
    await database.update(merchantProducts).set({
      identityKey: input.identityKey,
      gtin: normalizeGtin(input.gtin),
      title: input.title,
      brand: input.brand,
      model: input.model,
      url: input.url,
      variantKey: input.variantKey,
      lastSeenAt: input.observedAt,
      updatedAt: new Date().toISOString(),
    }).where(eq(merchantProducts.id, current.id));
    return {
      canonicalProductId: current.canonicalProductId,
      merchantProductId: current.id,
      method: current.matchMethod as CanonicalMatch["method"],
      score: current.matchScore,
      reviewStatus: current.reviewStatus === "confirmed" || current.reviewStatus === "automatic"
        ? "automatic"
        : "needs_review",
      comparisonEligible: current.matchScore >= 80 && current.reviewStatus !== "needs_review",
    };
  }

  const identity = matchIdentity(input);
  const candidate = identity.gtinKey
    ? (await database.select().from(canonicalProducts).where(eq(canonicalProducts.gtinKey, identity.gtinKey)).limit(1))[0]
    : identity.brandKey && identity.modelKey
      ? (await database.select().from(canonicalProducts).where(and(
          eq(canonicalProducts.brandKey, identity.brandKey),
          eq(canonicalProducts.modelKey, identity.modelKey),
        )).limit(1))[0]
      : undefined;
  const canonicalProductId = candidate?.id ?? await stableId("cp", identity.key);
  const reviewStatus = identity.score >= 80 ? "automatic" as const : "needs_review" as const;
  const now = new Date().toISOString();

  await database.insert(canonicalProducts).values({
    id: canonicalProductId,
    gtinKey: identity.gtinKey,
    title: input.title,
    brand: input.brand,
    brandKey: identity.brandKey,
    model: input.model,
    modelKey: identity.modelKey,
    category: input.category,
    reviewStatus,
    matchConfidence: identity.score,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: canonicalProducts.id,
    set: {
      title: input.title,
      brand: input.brand,
      model: input.model,
      category: input.category,
      matchConfidence: Math.max(candidate?.matchConfidence ?? 0, identity.score),
      updatedAt: now,
    },
  });

  const merchantProductId = current?.id ?? await stableId(
    "mp",
    `${input.source}:${input.market}:${input.externalId}`,
  );
  await database.insert(merchantProducts).values({
    id: merchantProductId,
    canonicalProductId,
    source: input.source,
    market: input.market,
    externalId: input.externalId,
    identityKey: input.identityKey,
    gtin: identity.gtinKey,
    title: input.title,
    brand: input.brand,
    model: input.model,
    url: input.url,
    variantKey: input.variantKey,
    matchMethod: identity.method,
    matchScore: identity.score,
    reviewStatus,
    lastSeenAt: input.observedAt,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [merchantProducts.source, merchantProducts.market, merchantProducts.externalId],
    set: {
      canonicalProductId,
      identityKey: input.identityKey,
      gtin: identity.gtinKey,
      title: input.title,
      brand: input.brand,
      model: input.model,
      url: input.url,
      variantKey: input.variantKey,
      matchMethod: identity.method,
      matchScore: identity.score,
      reviewStatus,
      lastSeenAt: input.observedAt,
      updatedAt: now,
    },
  });

  return {
    canonicalProductId,
    merchantProductId,
    method: identity.method,
    score: identity.score,
    reviewStatus,
    comparisonEligible: identity.score >= 80,
  };
}
