export type CartProbeStatus = "confirmed" | "product_page" | "blocked" | "unavailable";
export type AnomalyOrigin =
  | "true_anomaly"
  | "promotion"
  | "wrong_variant"
  | "seller_risk"
  | "conditional_price"
  | "shipping_unknown"
  | "refurbished"
  | "insufficient_evidence";

export type SellerFulfillment = "direct" | "platform" | "merchant" | "unknown";

export interface VariantFingerprint {
  key: string;
  confidence: number;
  attributes: {
    gtin: string | null;
    brand: string | null;
    model: string | null;
    storage: string | null;
    color: string | null;
    size: string | null;
    pack: number | null;
    condition: string;
  };
  comparable: boolean;
}

export interface CartProbeInput {
  status: CartProbeStatus;
  itemCents: number | null;
  shippingCents: number | null;
  totalCents: number | null;
  stockConfirmed: boolean;
  addToCartAvailable: boolean;
  identityConfirmed: boolean;
  explicitShipping: boolean;
  explicitTotal: boolean;
  couponApplied: boolean;
  checkedAt: string | null;
}

export interface SellerSignalsInput {
  trusted: boolean;
  ratingPercent: number | null;
  reviewCount: number | null;
  fulfillment: SellerFulfillment;
  country: string | null;
  warranty: boolean | null;
  returns: boolean | null;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function normalized(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function firstMatch(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1]) return match[1].replace(/\s+/gu, "").toLowerCase();
  }
  return null;
}

function colorFrom(value: string) {
  const colors: Array<[string, RegExp]> = [
    ["noir", /\b(noir|black|graphite|space gray)\b/i],
    ["blanc", /\b(blanc|white|ivoire)\b/i],
    ["bleu", /\b(bleu|blue|navy)\b/i],
    ["rouge", /\b(rouge|red|bordeaux)\b/i],
    ["vert", /\b(vert|green|olive)\b/i],
    ["rose", /\b(rose|pink)\b/i],
    ["argent", /\b(argent|silver)\b/i],
    ["or", /\b(or|gold|dore)\b/i],
    ["gris", /\b(gris|gray|grey)\b/i],
  ];
  return colors.find(([, pattern]) => pattern.test(value))?.[0] ?? null;
}

export function buildVariantFingerprint(input: {
  title: string;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
  expectedVariantId?: string | null;
  observedVariantId?: string | null;
  condition: string;
}): VariantFingerprint {
  const text = normalized([input.title, input.model].filter(Boolean).join(" "));
  const gtinDigits = (input.gtin ?? "").replace(/\D/gu, "");
  const gtin = gtinDigits.length >= 8 && gtinDigits.length <= 14 ? gtinDigits : null;
  const brand = normalized(input.brand) || null;
  const model = normalized(input.model) || null;
  const storage = firstMatch(text, [
    /\b(\d+(?:\.\d+)?\s*(?:tb|to))\b/i,
    /\b(\d+\s*(?:gb|go))\b/i,
  ]);
  const size = firstMatch(text, [
    /\b(\d{1,3}(?:[.,]\d)?\s*(?:pouces|inch|in|\"))\b/i,
    /\b(\d{2,3}\s*(?:cm|mm))\b/i,
    /\b(?:taille|size)\s*([a-z0-9-]{1,8})\b/i,
  ]);
  const packRaw = firstMatch(text, [
    /\b(?:lot|pack|x)\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s*(?:pieces|pcs|unites)\b/i,
  ]);
  const pack = packRaw ? Number.parseInt(packRaw, 10) : null;
  const color = colorFrom(text);
  const condition = normalized(input.condition) || "unknown";
  const variantMatches = !input.expectedVariantId || !input.observedVariantId
    ? null
    : input.expectedVariantId === input.observedVariantId;

  let confidence = gtin ? 72 : model ? 48 : brand ? 28 : 18;
  confidence += storage ? 8 : 0;
  confidence += size ? 6 : 0;
  confidence += color ? 4 : 0;
  confidence += pack ? 4 : 0;
  confidence = variantMatches === true ? Math.max(78, confidence + 6) : variantMatches === false ? confidence - 45 : confidence;
  confidence = clamp(confidence);

  const attributes = { gtin, brand, model, storage, color, size, pack, condition };
  const parts = Object.entries(attributes)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}:${String(value)}`);
  if (variantMatches === true && input.observedVariantId) parts.push(`variant:${normalized(input.observedVariantId)}`);
  return {
    key: parts.join("|") || `title:${text.slice(0, 96)}`,
    confidence,
    attributes,
    comparable: confidence >= 70 && variantMatches !== false,
  };
}

export function evaluateShadowCart(input: CartProbeInput, fallback: {
  itemCents: number;
  shippingCents: number | null;
  available: boolean;
}) {
  const itemCents = input.itemCents ?? fallback.itemCents;
  const shippingCents = input.shippingCents ?? fallback.shippingCents;
  const computedTotal = shippingCents === null ? null : itemCents + shippingCents;
  const finalTotalCents = input.totalCents ?? computedTotal;
  const consistent = input.explicitTotal
    && input.explicitShipping
    && input.totalCents !== null
    && input.shippingCents !== null
    && input.itemCents !== null
    && Math.abs(input.totalCents - (input.itemCents + input.shippingCents)) <= 1;
  const verified = input.status === "confirmed"
    && input.stockConfirmed
    && input.identityConfirmed
    && input.couponApplied
    && consistent;
  return {
    ...input,
    itemCents,
    shippingCents,
    finalTotalCents,
    consistent,
    verified,
    usable: input.status !== "blocked" && input.status !== "unavailable" && fallback.available,
  };
}

export function buildPriceRadarIndex(currentCents: number, comparablePricesCents: number[]) {
  const prices = comparablePricesCents
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .sort((a, b) => a - b);
  const all = [...prices, currentCents].sort((a, b) => a - b);
  const middle = Math.floor(all.length / 2);
  const medianCents = all.length % 2 === 0
    ? Math.round((all[middle - 1] + all[middle]) / 2)
    : all[middle];
  const bestCents = all[0];
  const marketDiscountPercent = medianCents > 0
    ? Math.round(((medianCents - currentCents) / medianCents) * 100)
    : 0;
  const rank = all.findIndex((price) => price === currentCents) + 1;
  return {
    medianCents,
    bestCents,
    currentCents,
    merchantCount: all.length,
    marketDiscountPercent,
    marketPosition: all.length >= 2 && rank === 1
      ? "best"
      : marketDiscountPercent >= 10 ? "below_market" : marketDiscountPercent <= -10 ? "above_market" : "market",
    rank,
  };
}

export function scoreSeller(input: SellerSignalsInput) {
  let score = input.trusted ? 58 : 34;
  const reasons: string[] = [];
  if (input.ratingPercent !== null) {
    score += (input.ratingPercent - 80) * 0.7;
    reasons.push(`note ${Math.round(input.ratingPercent)} %`);
  }
  if (input.reviewCount !== null) {
    score += Math.min(12, Math.log10(Math.max(1, input.reviewCount)) * 4);
    if (input.reviewCount < 10) score -= 12;
  }
  if (input.fulfillment === "direct") score += 18;
  else if (input.fulfillment === "platform") score += 12;
  else if (input.fulfillment === "merchant") score -= 2;
  else score -= 8;
  if (input.warranty === true) score += 7;
  if (input.warranty === false) score -= 14;
  if (input.returns === true) score += 5;
  if (input.returns === false) score -= 12;
  const finalScore = clamp(score);
  return {
    score: finalScore,
    level: finalScore >= 80 ? "excellent" : finalScore >= 65 ? "acceptable" : finalScore >= 45 ? "risk" : "high_risk",
    reasons,
    signals: input,
  };
}

export function classifyOffer(input: {
  anomalyScore: number;
  discountPercent: number;
  priceAccessibleToAll: boolean;
  promotionType: string;
  condition: string;
  shippingKnown: boolean;
  variant: VariantFingerprint;
  sellerScore: number;
  cartStatus: CartProbeStatus;
  historyPoints: number;
  merchantCount: number;
}) {
  let kind: AnomalyOrigin = "insufficient_evidence";
  if (input.condition === "refurbished" || input.condition === "used") kind = "refurbished";
  else if (!input.variant.comparable) kind = "wrong_variant";
  else if (!input.priceAccessibleToAll) kind = "conditional_price";
  else if (!input.shippingKnown) kind = "shipping_unknown";
  else if (input.sellerScore < 55) kind = "seller_risk";
  else if (input.promotionType !== "public_price") kind = "promotion";
  else if (input.anomalyScore >= 65 && input.discountPercent >= 20) kind = "true_anomaly";
  const evidenceStrength = clamp(
    input.variant.confidence * 0.25
    + input.sellerScore * 0.2
    + Math.min(25, input.historyPoints * 2.5)
    + Math.min(20, input.merchantCount * 5)
    + (input.cartStatus === "confirmed" ? 10 : input.cartStatus === "product_page" ? 4 : 0),
  );
  return {
    kind,
    evidenceStrength,
    actionable: kind === "true_anomaly" || kind === "promotion",
  };
}

export function predictOpportunityLifetime(input: {
  observedAt: string;
  sourceMedianMinutes: number | null;
  anomalyScore: number;
  discountPercent: number;
  available: boolean;
  cartConfirmed: boolean;
}) {
  const baseline = input.sourceMedianMinutes ?? 95;
  const intensity = Math.max(0, input.discountPercent - 20) * 1.1 + Math.max(0, input.anomalyScore - 65) * 0.65;
  const verificationBonus = input.cartConfirmed ? 12 : 0;
  const predictedLifetimeMinutes = input.available
    ? clamp(baseline - intensity + verificationBonus, 10, 360)
    : 0;
  const urgencyScore = input.available
    ? clamp(100 - predictedLifetimeMinutes / 3 + input.anomalyScore * 0.35, 0, 100)
    : 0;
  return {
    predictedLifetimeMinutes,
    urgencyScore,
    predictedExpiresAt: new Date(Date.parse(input.observedAt) + predictedLifetimeMinutes * 60_000).toISOString(),
    confidence: input.sourceMedianMinutes === null ? "estimated" : "learned",
  };
}

export function sentinelPriority(input: {
  depth: number;
  anomalyHits: number;
  duplicates: number;
  blocked: boolean;
  ageMinutes: number;
}) {
  return clamp(
    72
    - input.depth * 8
    + Math.min(24, input.anomalyHits * 6)
    - Math.min(30, input.duplicates * 3)
    - (input.blocked ? 45 : 0)
    + Math.min(12, input.ageMinutes / 120),
  );
}
