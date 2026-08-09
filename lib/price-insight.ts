const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const DEFAULT_WINDOW_DAYS = 90;

export type PriceInsightClassification =
  | "probable_error"
  | "recent_drop"
  | "stable_good_price"
  | "normal_price";

export type PriceInsightPoint = {
  totalCents: number;
  observedAt: string;
  available?: boolean;
};

export type PriceInsight = {
  classification: PriceInsightClassification;
  classificationLabel: "Erreur probable" | "Baisse récente" | "Bon prix stable" | "Prix normal";
  baselineCents: number | null;
  discountPercent: number;
  rarityScore: number | null;
  priceSeenPercent: number | null;
  daysAtOrBelow: number | null;
  coverageDays: number;
  stableSince: string | null;
  stableDays: number | null;
  lastDropAt: string | null;
  dropAgeMinutes: number | null;
  shouldAutoClose: boolean;
  explanation: string;
};

type TimedPrice = { totalCents: number; observedAtMs: number };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * clamp(ratio, 0, 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? null;
  const progress = position - lower;
  return (sorted[lower] ?? 0) * (1 - progress) + (sorted[upper] ?? 0) * progress;
}

function withoutIsolatedOutliers(points: TimedPrice[], currentTotalCents: number) {
  if (points.length < 4) return points;
  const values = points.map((point) => point.totalCents);
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  if (q1 === null || q3 === null) return points;
  const spread = q3 - q1;
  if (spread <= 0) return points;
  const minimum = Math.max(1, q1 - spread * 1.5);
  const maximum = q3 + spread * 1.5;
  const filtered = points.filter((point) =>
    samePrice(point.totalCents, currentTotalCents)
    || (point.totalCents >= minimum && point.totalCents <= maximum)
  );
  return filtered.length >= 3 ? filtered : points;
}

function weightedMedian(segments: Array<{ price: number; durationMs: number }>) {
  const usable = segments.filter((segment) => segment.durationMs > 0);
  const totalDuration = usable.reduce((sum, segment) => sum + segment.durationMs, 0);
  if (totalDuration <= 0) return null;
  const sorted = [...usable].sort((left, right) => left.price - right.price);
  let duration = 0;
  for (const segment of sorted) {
    duration += segment.durationMs;
    if (duration >= totalDuration / 2) return segment.price;
  }
  return sorted.at(-1)?.price ?? null;
}

function samePrice(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(1, Math.round(right * 0.01));
}

function labelFor(classification: PriceInsightClassification): PriceInsight["classificationLabel"] {
  if (classification === "probable_error") return "Erreur probable";
  if (classification === "recent_drop") return "Baisse récente";
  if (classification === "stable_good_price") return "Bon prix stable";
  return "Prix normal";
}

export function buildPriceInsight(input: {
  currentTotalCents: number | null;
  observedAt: string;
  history: PriceInsightPoint[];
  fallbackBaselineCents?: number | null;
  windowDays?: number;
}): PriceInsight {
  const observedAtMs = Date.parse(input.observedAt);
  const current = input.currentTotalCents;
  const empty: PriceInsight = {
    classification: "normal_price",
    classificationLabel: "Prix normal",
    baselineCents: input.fallbackBaselineCents ?? null,
    discountPercent: 0,
    rarityScore: null,
    priceSeenPercent: null,
    daysAtOrBelow: null,
    coverageDays: 0,
    stableSince: null,
    stableDays: null,
    lastDropAt: null,
    dropAgeMinutes: null,
    shouldAutoClose: false,
    explanation: "Historique encore insuffisant pour qualifier ce prix.",
  };
  if (current === null || !Number.isSafeInteger(current) || current <= 0 || !Number.isFinite(observedAtMs)) return empty;
  const currentTotal = current;

  const windowDays = clamp(Math.round(input.windowDays ?? DEFAULT_WINDOW_DAYS), 7, 180);
  const windowStartMs = observedAtMs - windowDays * DAY_MS;
  const byTimestamp = new Map<number, TimedPrice>();
  for (const point of input.history) {
    if (point.available === false || !Number.isSafeInteger(point.totalCents) || point.totalCents <= 0) continue;
    const timestamp = Date.parse(point.observedAt);
    if (!Number.isFinite(timestamp) || timestamp >= observedAtMs || timestamp < observedAtMs - 180 * DAY_MS) continue;
    byTimestamp.set(timestamp, { totalCents: point.totalCents, observedAtMs: timestamp });
  }
  const allPoints = [...byTimestamp.values()].sort((left, right) => left.observedAtMs - right.observedAtMs);
  const filtered = withoutIsolatedOutliers(allPoints, currentTotal);
  if (filtered.length === 0) return empty;

  const pointBeforeWindow = [...filtered].reverse().find((point) => point.observedAtMs <= windowStartMs) ?? null;
  const timeline = [
    ...(pointBeforeWindow ? [{ ...pointBeforeWindow, observedAtMs: windowStartMs }] : []),
    ...filtered.filter((point) => point.observedAtMs > windowStartMs),
  ];
  const deduplicated = timeline.filter((point, index, values) => {
    const previous = values[index - 1];
    return !previous || previous.observedAtMs !== point.observedAtMs;
  });
  const segments = deduplicated.map((point, index) => ({
    price: point.totalCents,
    durationMs: Math.max(0, (deduplicated[index + 1]?.observedAtMs ?? observedAtMs) - point.observedAtMs),
  }));
  const totalDurationMs = segments.reduce((sum, segment) => sum + segment.durationMs, 0);
  const coverageDays = roundOne(totalDurationMs / DAY_MS);
  const baselineFromHistory = weightedMedian(segments);
  const reliableHistory = filtered.length >= 5 && coverageDays >= 7;
  const baselineCents = reliableHistory
    ? baselineFromHistory
    : input.fallbackBaselineCents ?? baselineFromHistory;
  const discountPercent = baselineCents && baselineCents > currentTotal
    ? roundOne(((baselineCents - currentTotal) / baselineCents) * 100)
    : 0;
  const atOrBelowDurationMs = segments
    .filter((segment) => segment.price <= currentTotal * 1.01)
    .reduce((sum, segment) => sum + segment.durationMs, 0);
  const priceSeenPercent = reliableHistory && totalDurationMs > 0
    ? roundOne((atOrBelowDurationMs / totalDurationMs) * 100)
    : null;
  const rarityScore = priceSeenPercent === null ? null : Math.round(clamp(100 - priceSeenPercent, 0, 100));
  const daysAtOrBelow = priceSeenPercent === null ? null : roundOne(atOrBelowDurationMs / DAY_MS);

  let stableSinceMs = observedAtMs;
  let priorDistinct: TimedPrice | null = null;
  for (let index = filtered.length - 1; index >= 0; index -= 1) {
    const point = filtered[index];
    if (samePrice(point.totalCents, currentTotal)) stableSinceMs = point.observedAtMs;
    else {
      priorDistinct = point;
      break;
    }
  }
  const stableSince = new Date(stableSinceMs).toISOString();
  const stableDays = roundOne((observedAtMs - stableSinceMs) / DAY_MS);
  const isDrop = priorDistinct !== null && priorDistinct.totalCents >= currentTotal * 1.03;
  const lastDropAt = isDrop ? stableSince : null;
  const dropAgeMinutes = lastDropAt === null ? null : roundOne((observedAtMs - stableSinceMs) / MINUTE_MS);
  const recentDrop = dropAgeMinutes !== null && dropAgeMinutes <= 72 * 60;

  let classification: PriceInsightClassification = "normal_price";
  if (reliableHistory && recentDrop && discountPercent >= 35 && (rarityScore ?? 0) >= 85) {
    classification = "probable_error";
  } else if (recentDrop && discountPercent >= 15 && (!reliableHistory || (rarityScore ?? 0) >= 60)) {
    classification = "recent_drop";
  } else if (discountPercent >= 10 && (!reliableHistory || (rarityScore ?? 0) >= 30)) {
    classification = "stable_good_price";
  }

  const shouldAutoClose = reliableHistory
    && classification === "normal_price"
    && (discountPercent < 8 || (priceSeenPercent ?? 0) >= 70);
  const explanation = classification === "probable_error"
    ? `Prix très rare : observé ${priceSeenPercent ?? 0} % du temps sur ${Math.round(coverageDays)} jours.`
    : classification === "recent_drop"
      ? "Baisse récente confirmée par la chronologie du prix."
      : classification === "stable_good_price"
        ? `Prix intéressant mais déjà stable depuis ${Math.max(1, Math.round(stableDays))} jour${stableDays >= 1.5 ? "s" : ""}.`
        : reliableHistory
          ? "Le prix actuel se situe dans sa zone habituelle récente."
          : empty.explanation;

  return {
    classification,
    classificationLabel: labelFor(classification),
    baselineCents: baselineCents === null ? null : Math.round(baselineCents),
    discountPercent,
    rarityScore,
    priceSeenPercent,
    daysAtOrBelow,
    coverageDays,
    stableSince,
    stableDays,
    lastDropAt,
    dropAgeMinutes,
    shouldAutoClose,
    explanation,
  };
}
