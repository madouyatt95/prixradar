export type PushPreferenceSnapshot = {
  minScore: number;
  minSellerScore: number;
  requireExactVariant: boolean;
  requireCartConfirmation: boolean;
  maxAlertAgeMinutes: number;
  minimumHistoryPoints: number;
  minDiscount: number;
  maxPriceCents: number | null;
  marketsJson: string;
  categoriesJson: string;
  sourcesJson: string;
  deliveryCountry: string;
  postalCode: string | null;
  deliveryMode: string;
  requireLocationMatch: boolean;
  notificationSpeed: string;
};

export type PushAlertSnapshot = {
  score: number;
  sellerScore: number;
  historyPoints: number;
  exactVariantConfirmed: boolean;
  cartConfirmed: boolean;
  verifiedAt: string | null;
  discountPercent: number;
  priceCents: number;
  publicPriceCents: number | null;
  source: string;
  market: string;
  category: string | null;
  deliveryCountry: string | null;
  deliveryPostalPrefix: string | null;
  deliveryMode: string | null;
  locationVerified: boolean;
};

function list(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function postalPrefix(country: string, value: string | null) {
  if (!value) return "";
  return country === "GB"
    ? value.toUpperCase().replace(/\s.+$/u, "").slice(0, 4)
    : value.toUpperCase().slice(0, 2);
}

export function alertMatchesPushPreferences(input: {
  preferences: PushPreferenceSnapshot;
  alert: PushAlertSnapshot;
  tier: "urgent" | "personal" | "digest";
  radarMatches: boolean;
  nowMs?: number;
}) {
  const { preferences, alert, tier, radarMatches } = input;
  const nowMs = input.nowMs ?? Date.now();
  const verifiedAt = alert.verifiedAt ? Date.parse(alert.verifiedAt) : Number.NaN;
  const priceCents = alert.publicPriceCents ?? alert.priceCents;
  const markets = list(preferences.marketsJson);
  const categories = list(preferences.categoriesJson);
  const sources = list(preferences.sourcesJson);
  const expectedPostalPrefix = postalPrefix(preferences.deliveryCountry, preferences.postalCode);
  const actualPostalPrefix = (alert.deliveryPostalPrefix ?? "").toUpperCase();
  const compatibleDeliveryMode = preferences.deliveryMode === "either"
    || alert.deliveryMode === "either"
    || preferences.deliveryMode === alert.deliveryMode;
  const locationMatches = !preferences.requireLocationMatch || (
    alert.locationVerified
    && preferences.deliveryCountry === alert.deliveryCountry
    && compatibleDeliveryMode
    && (expectedPostalPrefix === "" || expectedPostalPrefix === actualPostalPrefix)
  );
  const speedMatches = tier === "digest"
    ? preferences.notificationSpeed === "digest"
    : tier === "personal"
      ? preferences.notificationSpeed !== "digest"
        && (preferences.notificationSpeed !== "balanced" || alert.score >= Math.min(100, preferences.minScore + 8))
      : true;

  return alert.score >= preferences.minScore
    && alert.discountPercent >= preferences.minDiscount
    && alert.sellerScore >= preferences.minSellerScore
    && alert.historyPoints >= preferences.minimumHistoryPoints
    && Number.isFinite(verifiedAt)
    && verifiedAt >= nowMs - preferences.maxAlertAgeMinutes * 60_000
    && (!preferences.requireExactVariant || alert.exactVariantConfirmed)
    && (!preferences.requireCartConfirmation || alert.cartConfirmed)
    && (preferences.maxPriceCents === null || priceCents <= preferences.maxPriceCents)
    && (markets.length === 0 || markets.includes(alert.market))
    && (categories.length === 0 || categories.includes(alert.category ?? ""))
    && (sources.length === 0 || sources.includes(alert.source))
    && locationMatches
    && radarMatches
    && speedMatches;
}
