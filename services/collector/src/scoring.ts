import type { AnomalyScore, OfferSnapshot } from "./types.js";

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function scoreOffer(offer: OfferSnapshot, baselineMinor?: number | null): AnomalyScore {
  const currentMinor = offer.total?.amountMinor ?? offer.price.amountMinor;
  const reference = baselineMinor && baselineMinor > 0
    ? baselineMinor
    : offer.referencePrice?.amountMinor ?? null;
  const reasons: string[] = [];

  if (reference === null || reference <= currentMinor) {
    return { score: 0, classification: "none", discountPercent: null, reasons: ["Aucune référence de prix supérieure fiable."] };
  }

  const discountPercent = round((1 - currentMinor / reference) * 100);
  let score = Math.min(70, Math.max(0, discountPercent * 1.25));
  reasons.push(`Baisse de ${discountPercent}% face à la référence.`);

  if (offer.availability === "in_stock") {
    score += 8;
    reasons.push("Produit indiqué en stock.");
  } else if (offer.availability === "out_of_stock") {
    score -= 25;
    reasons.push("Produit indiqué hors stock.");
  }
  if (offer.sellerTrusted) score += 5;
  else reasons.push("Vendeur direct non confirmé.");
  if (offer.product.gtin || offer.product.model) score += 7;
  else reasons.push("Identité produit partielle.");
  if (offer.shipping === null) {
    score = Math.min(score - 5, 59);
    reasons.push("Livraison inconnue.");
  }
  if (offer.condition !== "new") {
    score -= 15;
    reasons.push("État neuf non confirmé.");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const classification = score >= 80 && discountPercent >= 40
    ? "strong"
    : score >= 60 && discountPercent >= 25
      ? "probable"
      : score >= 35 && discountPercent >= 15
        ? "watch"
        : "none";
  return { score, classification, discountPercent, reasons };
}
