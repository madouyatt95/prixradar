export type PublicMetricStatus =
  | "measured"
  | "insufficient_sample"
  | "unavailable"
  | "incomplete_data";

export type PublicMeasurement = {
  status: PublicMetricStatus;
  value: number | null;
  unit: "percent" | "minutes";
  sampleSize: number;
  minimumSampleSize: number;
  numerator?: number;
  denominator?: number;
};

export type ReliabilityAlert = {
  id: string;
  source: string;
  category: string | null;
  observedAt: string;
  verifiedAt: string | null;
  shippingCents: number | null;
  status: string;
};

export type ReliabilityFeedback = {
  alertId: string;
  verdict: string;
};

export type ReliabilityObservation = {
  alertId: string;
  available: boolean;
  observedAt: string;
};

export type ReliabilityDelivery = {
  alertId: string;
  sentAt: string | null;
};

export type ReliabilityOptions = {
  minimumRateSample?: number;
  minimumLatencySample?: number;
  minimumGroupSample?: number;
  followUpToleranceMinutes?: number;
  incomplete?: boolean;
};

const POSITIVE_VERDICTS = new Set(["useful", "purchased", "price_confirmed"]);
const NEGATIVE_VERDICTS = new Set(["false_positive", "cancelled", "wrong_variant", "coupon_failed"]);

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function validTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function rateMeasurement(
  numerator: number,
  denominator: number,
  minimumSampleSize: number,
  incomplete: boolean,
): PublicMeasurement {
  const status: PublicMetricStatus = incomplete
    ? "incomplete_data"
    : denominator === 0
      ? "unavailable"
      : denominator < minimumSampleSize
        ? "insufficient_sample"
        : "measured";
  return {
    status,
    value: status === "measured" ? roundOne((numerator / denominator) * 100) : null,
    unit: "percent",
    sampleSize: denominator,
    minimumSampleSize,
    numerator,
    denominator,
  };
}

function medianMeasurement(
  values: number[],
  minimumSampleSize: number,
  incomplete: boolean,
): PublicMeasurement {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const status: PublicMetricStatus = incomplete
    ? "incomplete_data"
    : sorted.length === 0
      ? "unavailable"
      : sorted.length < minimumSampleSize
        ? "insufficient_sample"
        : "measured";
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length === 0
    ? null
    : sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return {
    status,
    value: status === "measured" && median !== null ? roundOne(median) : null,
    unit: "minutes",
    sampleSize: sorted.length,
    minimumSampleSize,
  };
}

function feedbackOutcomes(feedback: ReliabilityFeedback[]) {
  const votes = new Map<string, { positive: number; negative: number }>();
  for (const entry of feedback) {
    const current = votes.get(entry.alertId) ?? { positive: 0, negative: 0 };
    if (POSITIVE_VERDICTS.has(entry.verdict)) current.positive += 1;
    if (NEGATIVE_VERDICTS.has(entry.verdict)) current.negative += 1;
    votes.set(entry.alertId, current);
  }
  const outcomes = new Map<string, "positive" | "negative">();
  for (const [alertId, vote] of votes) {
    if (vote.positive > vote.negative) outcomes.set(alertId, "positive");
    if (vote.negative > vote.positive) outcomes.set(alertId, "negative");
  }
  return outcomes;
}

function availabilityAt(
  alerts: ReliabilityAlert[],
  observations: ReliabilityObservation[],
  minutes: number,
  toleranceMinutes: number,
  minimumSampleSize: number,
  incomplete: boolean,
) {
  const pointsByAlert = new Map<string, ReliabilityObservation[]>();
  for (const point of observations) {
    const points = pointsByAlert.get(point.alertId) ?? [];
    points.push(point);
    pointsByAlert.set(point.alertId, points);
  }
  let available = 0;
  let monitored = 0;
  for (const alert of alerts) {
    const firstSeen = validTimestamp(alert.observedAt);
    if (firstSeen === null) continue;
    const target = firstSeen + minutes * 60_000;
    const deadline = target + toleranceMinutes * 60_000;
    const followUp = (pointsByAlert.get(alert.id) ?? [])
      .map((point) => ({ point, timestamp: validTimestamp(point.observedAt) }))
      .filter((entry): entry is { point: ReliabilityObservation; timestamp: number } =>
        entry.timestamp !== null && entry.timestamp >= target && entry.timestamp <= deadline)
      .sort((left, right) => left.timestamp - right.timestamp)[0];
    if (!followUp) continue;
    monitored += 1;
    if (followUp.point.available) available += 1;
  }
  return rateMeasurement(available, monitored, minimumSampleSize, incomplete);
}

function groupReliability(
  alerts: ReliabilityAlert[],
  outcomes: Map<string, "positive" | "negative">,
  keyFor: (alert: ReliabilityAlert) => string,
  minimumSampleSize: number,
  incomplete: boolean,
) {
  const groups = new Map<string, ReliabilityAlert[]>();
  for (const alert of alerts) {
    const key = keyFor(alert);
    const rows = groups.get(key) ?? [];
    rows.push(alert);
    groups.set(key, rows);
  }
  return [...groups.entries()]
    .map(([key, rows]) => {
      const assessed = rows.filter((row) => outcomes.has(row.id));
      const negative = assessed.filter((row) => outcomes.get(row.id) === "negative").length;
      const knownTotal = rows.filter((row) => row.shippingCents !== null).length;
      return {
        key,
        alerts: rows.length,
        falsePositiveRate: rateMeasurement(negative, assessed.length, minimumSampleSize, incomplete),
        totalPriceKnownRate: rateMeasurement(knownTotal, rows.length, minimumSampleSize, incomplete),
      };
    })
    .sort((left, right) => right.alerts - left.alerts || left.key.localeCompare(right.key, "fr"));
}

export function computeReliabilityMetrics(input: {
  alerts: ReliabilityAlert[];
  feedback: ReliabilityFeedback[];
  observations: ReliabilityObservation[];
  deliveries: ReliabilityDelivery[];
}, options: ReliabilityOptions = {}) {
  const minimumRateSample = options.minimumRateSample ?? 30;
  const minimumLatencySample = options.minimumLatencySample ?? 10;
  const minimumGroupSample = options.minimumGroupSample ?? 10;
  const toleranceMinutes = options.followUpToleranceMinutes ?? 15;
  const incomplete = options.incomplete === true;
  const outcomes = feedbackOutcomes(input.feedback);
  const assessed = input.alerts.filter((alert) => outcomes.has(alert.id));
  const negative = assessed.filter((alert) => outcomes.get(alert.id) === "negative").length;
  const positive = assessed.filter((alert) => outcomes.get(alert.id) === "positive").length;
  const knownTotal = input.alerts.filter((alert) => alert.shippingCents !== null).length;
  const doubleVerified = input.alerts.filter((alert) => {
    const observedAt = validTimestamp(alert.observedAt);
    const verifiedAt = validTimestamp(alert.verifiedAt);
    return observedAt !== null && verifiedAt !== null && verifiedAt >= observedAt;
  }).length;

  const alertById = new Map(input.alerts.map((alert) => [alert.id, alert]));
  const earliestSent = new Map<string, number>();
  for (const delivery of input.deliveries) {
    const sentAt = validTimestamp(delivery.sentAt);
    if (sentAt === null || !alertById.has(delivery.alertId)) continue;
    const current = earliestSent.get(delivery.alertId);
    if (current === undefined || sentAt < current) earliestSent.set(delivery.alertId, sentAt);
  }
  const notificationLatencies = [...earliestSent.entries()].flatMap(([alertId, sentAt]) => {
    const observedAt = validTimestamp(alertById.get(alertId)?.observedAt);
    if (observedAt === null || sentAt < observedAt) return [];
    return [(sentAt - observedAt) / 60_000];
  });

  const metrics = {
    falsePositiveRate: rateMeasurement(negative, assessed.length, minimumRateSample, incomplete),
    usefulAlertRate: rateMeasurement(positive, assessed.length, minimumRateSample, incomplete),
    totalPriceKnownRate: rateMeasurement(knownTotal, input.alerts.length, minimumRateSample, incomplete),
    doubleVerificationRate: rateMeasurement(doubleVerified, input.alerts.length, minimumRateSample, incomplete),
    notificationLatencyMedian: medianMeasurement(notificationLatencies, minimumLatencySample, incomplete),
    availabilityAfterMinutes: {
      "5": availabilityAt(input.alerts, input.observations, 5, toleranceMinutes, minimumRateSample, incomplete),
      "15": availabilityAt(input.alerts, input.observations, 15, toleranceMinutes, minimumRateSample, incomplete),
      "30": availabilityAt(input.alerts, input.observations, 30, toleranceMinutes, minimumRateSample, incomplete),
    },
  };
  const statuses = [
    metrics.falsePositiveRate.status,
    metrics.totalPriceKnownRate.status,
    metrics.doubleVerificationRate.status,
    metrics.notificationLatencyMedian.status,
    ...Object.values(metrics.availabilityAfterMinutes).map((measurement) => measurement.status),
  ];
  return {
    status: incomplete
      ? "incomplete_data"
      : statuses.every((status) => status === "measured")
        ? "measured"
        : "insufficient_sample",
    sample: {
      alerts: input.alerts.length,
      assessedAlerts: assessed.length,
      notificationsSent: notificationLatencies.length,
      followUpObservations: input.observations.length,
    },
    metrics,
    bySource: groupReliability(input.alerts, outcomes, (alert) => alert.source, minimumGroupSample, incomplete),
    byCategory: groupReliability(
      input.alerts,
      outcomes,
      (alert) => alert.category?.trim() || "Non classé",
      minimumGroupSample,
      incomplete,
    ).slice(0, 30),
  };
}

export type IntegrityObservation = {
  totalCents: number | null;
  available: boolean;
  observedAt: string;
};

export type PromotionIntegrityInput = {
  currentTotalCents: number | null;
  observedDiscountPercent: number;
  observedAt: string;
  history: IntegrityObservation[];
  marketMedianCents: number | null;
  marketMerchantCount: number;
  minimumHistoryPoints?: number;
};

export function evaluatePromotionIntegrity(input: PromotionIntegrityInput) {
  const observedAt = validTimestamp(input.observedAt);
  const current = input.currentTotalCents;
  const minimumHistoryPoints = input.minimumHistoryPoints ?? 5;
  const since = observedAt === null ? null : observedAt - 30 * 86_400_000;
  const distinctHistory = new Map<string, number>();
  for (const point of input.history) {
    const timestamp = validTimestamp(point.observedAt);
    if (
      !point.available ||
      timestamp === null ||
      observedAt === null ||
      since === null ||
      timestamp >= observedAt ||
      timestamp < since ||
      !Number.isSafeInteger(point.totalCents) ||
      (point.totalCents as number) <= 0
    ) continue;
    const totalCents = point.totalCents as number;
    distinctHistory.set(`${Math.floor(timestamp / 60_000)}:${totalCents}`, totalCents);
  }
  const historicalTotals = [...distinctHistory.values()];
  const lowest30dCents = historicalTotals.length === 0 ? null : Math.min(...historicalTotals);
  const historyMeasured = current !== null && current > 0 && historicalTotals.length >= minimumHistoryPoints;
  const marketMeasured = current !== null && current > 0
    && input.marketMedianCents !== null && input.marketMedianCents > 0
    && input.marketMerchantCount >= 2;
  const verified30dDiscountPercent = historyMeasured && lowest30dCents !== null
    ? roundOne(Math.max(0, ((lowest30dCents - current) / lowest30dCents) * 100))
    : null;
  const discountGapPoints = verified30dDiscountPercent === null
    ? null
    : roundOne(Math.max(0, input.observedDiscountPercent - verified30dDiscountPercent));
  const marketDiscountPercent = marketMeasured && input.marketMedianCents !== null && current !== null
    ? roundOne(((input.marketMedianCents - current) / input.marketMedianCents) * 100)
    : null;
  const historyIntegrityScore = discountGapPoints === null
    ? null
    : Math.round(clamp(100 - discountGapPoints * (100 / 30)));
  const marketPositionScore = marketDiscountPercent === null
    ? null
    : Math.round(clamp(50 + marketDiscountPercent * 2.5));
  const score = historyIntegrityScore === null || marketPositionScore === null
    ? null
    : Math.round(historyIntegrityScore * 0.65 + marketPositionScore * 0.35);
  return {
    status: score === null ? "insufficient_evidence" : "measured",
    score,
    label: score === null
      ? "Preuves insuffisantes"
      : score >= 85
        ? "Très cohérente"
        : score >= 70
          ? "Cohérente"
          : score >= 50
            ? "À vérifier"
            : "Référence fragile",
    inputs: {
      currentTotalCents: current,
      observedDiscountPercent: roundOne(input.observedDiscountPercent),
      lowestPrior30dCents: lowest30dCents,
      observationsPrior30d: historicalTotals.length,
      minimumHistoryPoints,
      marketMedianCents: input.marketMedianCents,
      marketMerchantCount: input.marketMerchantCount,
    },
    measures: {
      verified30dDiscountPercent,
      discountGapPoints,
      marketDiscountPercent,
    },
    components: {
      historyIntegrityScore,
      marketPositionScore,
      weights: { history: 0.65, market: 0.35 },
    },
    caveats: [
      ...(historyMeasured ? [] : ["historique_30_jours_insuffisant"]),
      ...(marketMeasured ? [] : ["comparaison_marche_insuffisante"]),
    ],
  };
}

export function aggregateIntegrityIndex(evaluations: Array<{ score: number | null }>, minimumSampleSize = 30) {
  const scores = evaluations.flatMap((evaluation) => evaluation.score === null ? [] : [evaluation.score]);
  if (scores.length < minimumSampleSize) {
    return {
      status: scores.length === 0 ? "unavailable" : "insufficient_sample",
      score: null,
      sampleSize: scores.length,
      minimumSampleSize,
      label: "Échantillon insuffisant",
    };
  }
  const score = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  return {
    status: "measured",
    score,
    sampleSize: scores.length,
    minimumSampleSize,
    label: score >= 85 ? "Très cohérent" : score >= 70 ? "Cohérent" : score >= 50 ? "À surveiller" : "Fragile",
  };
}
