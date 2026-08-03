export type PurchasabilityInput = {
  sourceMode: string;
  status: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  totalCents: number | null;
  priceAccessibleToAll: boolean;
  cartStatus?: string | null;
  variantConfidence?: number | null;
  sellerScore?: number | null;
  communityPositive?: number;
  communityNegative?: number;
};

export type Purchasability = {
  status: "confirmed" | "check_now" | "stale" | "blocked";
  label: string;
  message: string;
  totalCents: number | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  ageMinutes: number | null;
  minutesRemaining: number | null;
  checks: {
    live: boolean;
    available: boolean;
    publicPrice: boolean;
    totalKnown: boolean;
    cartConfirmed: boolean;
    exactVariant: boolean;
    trustedSeller: boolean;
    fresh: boolean;
  };
  blockers: string[];
  community: { positive: number; negative: number; confidencePercent: number | null };
};

const MAX_CONFIRMED_AGE_MINUTES = 60;

function minutesBetween(later: number, earlier: number) {
  return Math.max(0, Math.floor((later - earlier) / 60_000));
}

export function assessPurchasability(input: PurchasabilityInput, nowMs = Date.now()): Purchasability {
  const verifiedMs = input.verifiedAt ? Date.parse(input.verifiedAt) : Number.NaN;
  const expiresMs = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  const ageMinutes = Number.isFinite(verifiedMs) ? minutesBetween(nowMs, verifiedMs) : null;
  const minutesRemaining = Number.isFinite(expiresMs) && expiresMs > nowMs
    ? Math.max(0, Math.ceil((expiresMs - nowMs) / 60_000))
    : null;
  const checks = {
    live: input.sourceMode === "live",
    available: input.status === "active" && minutesRemaining !== null,
    publicPrice: input.priceAccessibleToAll,
    totalKnown: typeof input.totalCents === "number" && input.totalCents > 0,
    cartConfirmed: input.cartStatus === "confirmed",
    exactVariant: (input.variantConfidence ?? 0) >= 80,
    trustedSeller: (input.sellerScore ?? 0) >= 70,
    fresh: ageMinutes !== null && ageMinutes <= MAX_CONFIRMED_AGE_MINUTES,
  };
  const blockers: string[] = [];
  if (!checks.live) blockers.push("donnée de démonstration");
  if (!checks.available) blockers.push("prix expiré ou indisponible");
  if (!checks.publicPrice) blockers.push("prix soumis à une condition");
  if (!checks.totalKnown) blockers.push("total livré inconnu");
  if (!checks.cartConfirmed) blockers.push("panier final non confirmé");
  if (!checks.exactVariant) blockers.push("variante exacte à confirmer");
  if (!checks.trustedSeller) blockers.push("vendeur à vérifier");
  if (!checks.fresh) blockers.push("contrôle trop ancien");

  const hardBlock = !checks.live || !checks.available || !checks.publicPrice || !checks.totalKnown;
  const allConfirmed = Object.values(checks).every(Boolean);
  const status = allConfirmed ? "confirmed" : hardBlock ? "blocked" : checks.fresh ? "check_now" : "stale";
  const positive = Math.max(0, Math.trunc(input.communityPositive ?? 0));
  const negative = Math.max(0, Math.trunc(input.communityNegative ?? 0));
  const votes = positive + negative;

  return {
    status,
    label: status === "confirmed" ? "Achetable maintenant" : status === "check_now" ? "À confirmer maintenant" : status === "stale" ? "Contrôle à rafraîchir" : "Non achetable en confiance",
    message: status === "confirmed"
      ? "Le total, la variante, le vendeur et la disponibilité ont été confirmés récemment."
      : blockers.slice(0, 2).join(" · ") || "Une nouvelle vérification est nécessaire.",
    totalCents: input.totalCents,
    verifiedAt: input.verifiedAt,
    expiresAt: input.expiresAt,
    ageMinutes,
    minutesRemaining,
    checks,
    blockers,
    community: {
      positive,
      negative,
      confidencePercent: votes > 0 ? Math.round((positive / votes) * 100) : null,
    },
  };
}
