export type BuyNowDecision = {
  score: number;
  label: "Acheter maintenant" | "À considérer" | "Attendre";
  factors: Array<{ key: string; label: string; points: number; maximum: number }>;
  cautions: string[];
};

type BuyNowInput = {
  anomalyScore: number;
  discountPercent: number;
  robustZ?: number | null;
  marketDiscountPercent?: number | null;
  historyPoints?: number;
  verificationCount: number;
  sellerTrusted: boolean;
  available: boolean;
  shippingKnown: boolean;
  accessibleToAll: boolean;
  expiresAt?: string | null;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function evaluateBuyNow(input: BuyNowInput): BuyNowDecision {
  const confidence = Math.round(clamp(input.anomalyScore / 100, 0, 1) * 30);
  const rarityBase = Math.max(input.discountPercent, Math.max(0, input.robustZ ?? 0) * 5);
  const rarity = Math.round(clamp(rarityBase / 50, 0, 1) * 25);
  const market = Math.round(clamp((input.marketDiscountPercent ?? 0) / 35, 0, 1) * 20);
  const verificationChecks = [
    input.verificationCount >= 2,
    input.sellerTrusted,
    input.available,
    input.shippingKnown,
    (input.historyPoints ?? 0) >= 5,
  ].filter(Boolean).length;
  const verification = Math.round((verificationChecks / 5) * 15);
  const accessibility = input.accessibleToAll ? 10 : 0;
  let score = confidence + rarity + market + verification + accessibility;
  const cautions: string[] = [];
  if (!input.shippingKnown) cautions.push("Frais de livraison inconnus");
  if (!input.sellerTrusted) cautions.push("Vendeur à contrôler");
  if (!input.accessibleToAll) cautions.push("Prix soumis à une condition");
  if (!input.available) cautions.push("Stock non confirmé");
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
    score = Math.min(score, 20);
    cautions.push("Signal expiré");
  }
  score = Math.round(clamp(score, 0, 100));
  return {
    score,
    label: score >= 80 ? "Acheter maintenant" : score >= 60 ? "À considérer" : "Attendre",
    factors: [
      { key: "confidence", label: "Fiabilité du signal", points: confidence, maximum: 30 },
      { key: "rarity", label: "Rareté historique", points: rarity, maximum: 25 },
      { key: "market", label: "Écart face au marché", points: market, maximum: 20 },
      { key: "verification", label: "Contrôles achat", points: verification, maximum: 15 },
      { key: "accessibility", label: "Prix accessible", points: accessibility, maximum: 10 },
    ],
    cautions,
  };
}
