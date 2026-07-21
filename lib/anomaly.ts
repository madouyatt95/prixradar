export const ANOMALY_LIMITS = {
  maxPriceCents: 100_000_000,
  maxHistoryPoints: 60,
  maxHistoryAgeDays: 180,
  minHistoricalPoints: 5,
  minDiscountPercent: 20,
  minRobustZ: 3,
  maxFreshnessMinutes: 120,
  minNotificationScore: 65,
} as const;

export type SourceMode = "live" | "demo" | "fixture";
export type ProductCondition = "new" | "used" | "refurbished" | "unknown";
export type AnomalyConfidence = "very_likely" | "likely" | "review" | "insufficient";

export type HistoricalPrice = {
  priceCents?: number;
  shippingCents?: number | null;
  totalCents?: number | null;
  available: boolean;
  observedAt: string;
  rawHash?: string | null;
};

export type AnomalyCandidate = {
  priceCents: number;
  shippingCents: number | null;
  available: boolean;
  observedAt: string;
  expiresAt: string;
  sourceMode: SourceMode;
  condition: ProductCondition;
  expectedVariantId: string | null;
  observedVariantId: string | null;
  seller: string | null;
  sellerTrusted: boolean;
  verificationCount: number;
  verifiedAt: string | null;
  merchantReferenceCents?: number | null;
};

export type AnomalyEvaluation = {
  score: number;
  confidence: AnomalyConfidence;
  notificationEligible: boolean;
  currentTotalCents: number | null;
  usualPriceCents: number | null;
  baselineSource: "historical_median" | "merchant_reference" | "unavailable";
  historyPoints: number;
  madCents: number | null;
  robustZ: number | null;
  discountPercent: number;
  freshnessMinutes: number;
  checks: {
    liveSource: boolean;
    historicalBaseline: boolean;
    enoughHistory: boolean;
    materialDiscount: boolean;
    robustDeviation: boolean;
    freshObservation: boolean;
    exactVariant: boolean;
    trustedSeller: boolean;
    shippingIncluded: boolean;
    newCondition: boolean;
    available: boolean;
    secondVerification: boolean;
    notExpired: boolean;
  };
  blockingReasons: string[];
  components: {
    discount: number;
    robustDeviation: number;
    history: number;
    freshness: number;
    verification: number;
    safeguards: number;
  };
};

export class AnomalyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnomalyInputError";
  }
}

function assertMoney(value: number, field: string, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > ANOMALY_LIMITS.maxPriceCents) {
    throw new AnomalyInputError(`${field} doit être un entier valide en unités mineures.`);
  }
}

function parseTimestamp(value: string, field: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new AnomalyInputError(`${field} doit être une date ISO 8601.`);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new AnomalyInputError(`${field} doit être une date ISO 8601 valide.`);
  return timestamp;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function confidenceForScore(score: number): AnomalyConfidence {
  if (score >= 85) return "very_likely";
  if (score >= 65) return "likely";
  if (score >= 40) return "review";
  return "insufficient";
}

function totalForHistoryPoint(point: HistoricalPrice): number | null {
  if (Number.isSafeInteger(point.totalCents)) {
    const total = point.totalCents as number;
    return total >= 0 && total <= ANOMALY_LIMITS.maxPriceCents * 2 ? total : null;
  }

  if (!Number.isSafeInteger(point.priceCents) || !Number.isSafeInteger(point.shippingCents)) return null;
  const price = point.priceCents as number;
  const shipping = point.shippingCents as number;
  if (price < 0 || shipping < 0) return null;
  const total = price + shipping;
  return Number.isSafeInteger(total) && total <= ANOMALY_LIMITS.maxPriceCents * 2 ? total : null;
}

function normalizeHistory(history: HistoricalPrice[], observedAtMs: number) {
  const minimumTimestamp = observedAtMs - ANOMALY_LIMITS.maxHistoryAgeDays * 86_400_000;
  const seen = new Set<string>();
  const normalized: Array<{ totalCents: number; observedAtMs: number }> = [];

  for (const point of history.slice(0, ANOMALY_LIMITS.maxHistoryPoints * 3)) {
    if (!point.available) continue;
    const totalCents = totalForHistoryPoint(point);
    if (totalCents === null) continue;

    let pointTimestamp: number;
    try {
      pointTimestamp = parseTimestamp(point.observedAt, "history.observedAt");
    } catch {
      continue;
    }
    if (pointTimestamp >= observedAtMs || pointTimestamp < minimumTimestamp) continue;

    const rawIdentity = point.rawHash?.trim();
    const identity = rawIdentity || `${Math.floor(pointTimestamp / 60_000)}:${totalCents}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    normalized.push({ totalCents, observedAtMs: pointTimestamp });
  }

  return normalized
    .sort((left, right) => right.observedAtMs - left.observedAtMs)
    .slice(0, ANOMALY_LIMITS.maxHistoryPoints);
}

function blockingReasons(checks: AnomalyEvaluation["checks"]) {
  const labels: Record<keyof typeof checks, string> = {
    liveSource: "source_not_live",
    historicalBaseline: "historical_baseline_missing",
    enoughHistory: "history_too_short",
    materialDiscount: "discount_too_small",
    robustDeviation: "deviation_not_robust",
    freshObservation: "observation_stale",
    exactVariant: "variant_not_confirmed",
    trustedSeller: "seller_not_trusted",
    shippingIncluded: "shipping_unknown",
    newCondition: "condition_not_new",
    available: "offer_unavailable",
    secondVerification: "second_verification_missing",
    notExpired: "alert_expired",
  };

  return (Object.keys(checks) as Array<keyof typeof checks>)
    .filter((key) => !checks[key])
    .map((key) => labels[key]);
}

export function evaluatePriceAnomaly(
  candidate: AnomalyCandidate,
  history: HistoricalPrice[],
  now = new Date(),
): AnomalyEvaluation {
  assertMoney(candidate.priceCents, "priceCents", false);
  if (candidate.shippingCents !== null) assertMoney(candidate.shippingCents, "shippingCents");
  if (!Number.isInteger(candidate.verificationCount) || candidate.verificationCount < 0) {
    throw new AnomalyInputError("verificationCount doit être un entier positif.");
  }

  const observedAtMs = parseTimestamp(candidate.observedAt, "observedAt");
  const expiresAtMs = parseTimestamp(candidate.expiresAt, "expiresAt");
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new AnomalyInputError("La date de calcul est invalide.");
  if (observedAtMs > nowMs + 5 * 60_000) throw new AnomalyInputError("observedAt ne peut pas être dans le futur.");

  const verifiedAtMs = candidate.verifiedAt === null ? null : parseTimestamp(candidate.verifiedAt, "verifiedAt");
  if (verifiedAtMs !== null && verifiedAtMs < observedAtMs) {
    throw new AnomalyInputError("verifiedAt ne peut pas précéder observedAt.");
  }

  const shippingIncluded = candidate.shippingCents !== null;
  const currentTotalCents =
    candidate.shippingCents === null ? null : candidate.priceCents + candidate.shippingCents;
  if (
    currentTotalCents !== null &&
    (!Number.isSafeInteger(currentTotalCents) || currentTotalCents > ANOMALY_LIMITS.maxPriceCents * 2)
  ) {
    throw new AnomalyInputError("Le prix total dépasse la limite autorisée.");
  }

  const normalizedHistory = normalizeHistory(history, observedAtMs);
  const historicalTotals = normalizedHistory.map((point) => point.totalCents);
  const historicalMedian = median(historicalTotals);
  const merchantReference = candidate.merchantReferenceCents;
  if (merchantReference !== null && merchantReference !== undefined) {
    assertMoney(merchantReference, "merchantReferenceCents", false);
  }

  const baselineSource =
    historicalMedian !== null
      ? "historical_median"
      : merchantReference !== null && merchantReference !== undefined
        ? "merchant_reference"
        : "unavailable";
  const rawBaseline = historicalMedian ?? merchantReference ?? null;
  const usualPriceCents = rawBaseline === null ? null : Math.round(rawBaseline);
  const rawMad =
    historicalMedian === null ? null : median(historicalTotals.map((total) => Math.abs(total - historicalMedian)));
  const madCents = rawMad === null ? null : Math.round(rawMad);
  const discountPercent =
    rawBaseline === null || rawBaseline <= 0 || currentTotalCents === null
      ? 0
      : roundOne(((rawBaseline - currentTotalCents) / rawBaseline) * 100);
  const deviationCents = rawBaseline === null || currentTotalCents === null ? 0 : Math.max(0, rawBaseline - currentTotalCents);
  const robustZ =
    historicalMedian === null
      ? null
      : rawMad !== null && rawMad > 0
        ? roundOne((0.6745 * deviationCents) / rawMad)
        : deviationCents > 0
          ? 12
          : 0;
  const freshnessMinutes = Math.max(0, roundOne((nowMs - observedAtMs) / 60_000));

  const exactVariant =
    candidate.expectedVariantId !== null &&
    candidate.observedVariantId !== null &&
    candidate.expectedVariantId === candidate.observedVariantId;
  const trustedSeller = candidate.seller !== null && candidate.seller.trim().length > 0 && candidate.sellerTrusted;
  const secondVerification =
    candidate.verificationCount >= 2 && verifiedAtMs !== null && verifiedAtMs <= nowMs + 5 * 60_000;

  const checks: AnomalyEvaluation["checks"] = {
    liveSource: candidate.sourceMode === "live",
    historicalBaseline: baselineSource === "historical_median",
    enoughHistory: normalizedHistory.length >= ANOMALY_LIMITS.minHistoricalPoints,
    materialDiscount: discountPercent >= ANOMALY_LIMITS.minDiscountPercent,
    robustDeviation: robustZ !== null && robustZ >= ANOMALY_LIMITS.minRobustZ,
    freshObservation: freshnessMinutes <= ANOMALY_LIMITS.maxFreshnessMinutes,
    exactVariant,
    trustedSeller,
    shippingIncluded,
    newCondition: candidate.condition === "new",
    available: candidate.available,
    secondVerification,
    notExpired: expiresAtMs > nowMs,
  };

  const discountComponent = Math.round(clamp(((discountPercent - 5) / 45) * 35, 0, 35));
  const robustComponent = Math.round(clamp(((robustZ ?? 0) / 8) * 20, 0, 20));
  const historyComponent = Math.round(clamp((normalizedHistory.length / 10) * 10, 0, 10));
  const freshnessComponent = freshnessMinutes <= 15 ? 10 : freshnessMinutes <= 60 ? 8 : freshnessMinutes <= 120 ? 4 : 0;
  const verificationComponent = secondVerification ? 10 : candidate.verificationCount >= 1 ? 3 : 0;
  const safeguardsComponent = (exactVariant ? 5 : 0) + (trustedSeller ? 5 : 0) + (shippingIncluded ? 5 : 0);

  let score =
    discountComponent +
    robustComponent +
    historyComponent +
    freshnessComponent +
    verificationComponent +
    safeguardsComponent;

  if (baselineSource !== "historical_median") score = Math.min(score, 49);
  if (!exactVariant || !trustedSeller) score = Math.min(score, 49);
  if (!shippingIncluded) score = Math.min(score, 59);
  if (!candidate.available || candidate.condition !== "new") score = Math.min(score, 39);
  if (!checks.freshObservation || !checks.notExpired) score = Math.min(score, 49);
  score = clamp(Math.round(score), 0, 100);

  const reasons = blockingReasons(checks);
  const notificationEligible =
    score >= ANOMALY_LIMITS.minNotificationScore && Object.values(checks).every(Boolean);

  return {
    score,
    confidence: confidenceForScore(score),
    notificationEligible,
    currentTotalCents,
    usualPriceCents,
    baselineSource,
    historyPoints: normalizedHistory.length,
    madCents,
    robustZ,
    discountPercent,
    freshnessMinutes,
    checks,
    blockingReasons: reasons,
    components: {
      discount: discountComponent,
      robustDeviation: robustComponent,
      history: historyComponent,
      freshness: freshnessComponent,
      verification: verificationComponent,
      safeguards: safeguardsComponent,
    },
  };
}
