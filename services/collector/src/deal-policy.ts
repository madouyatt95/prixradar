import type { OfferSnapshot } from "./types.js";

export const NON_AMAZON_EXTREME_DISCOUNT_PERCENT = 70;

function normalized(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function isJdSportsAccessory(offer: OfferSnapshot) {
  if (offer.product.source !== "jd_sports") return false;
  const category = normalized(offer.product.category);
  if (/\b(?:accessoire|accessoires|accessory|accessories)\b/u.test(category)) return true;
  const title = normalized(offer.product.title);
  return /\b(?:chaussette|chaussettes|socks?|boxer|boxers|calecon|calecons|sacoche|banane|casquette|bonnet|gant|gants|portefeuille|sac a dos|backpack|ceinture|gourde)\b/u.test(title);
}

export function isExtremeRetailCandidate(offer: OfferSnapshot) {
  if (offer.product.source === "amazon") return true;
  if (isJdSportsAccessory(offer)) return false;
  const reference = offer.referencePrice?.amountMinor ?? null;
  if (reference === null || reference <= offer.price.amountMinor) return false;
  const discountPercent = Math.round(((reference - offer.price.amountMinor) / reference) * 100);
  return discountPercent >= NON_AMAZON_EXTREME_DISCOUNT_PERCENT;
}

export function offerDiscountPercent(offer: OfferSnapshot) {
  const reference = offer.referencePrice?.amountMinor ?? null;
  if (reference === null || reference <= offer.price.amountMinor) return 0;
  return Math.max(0, Math.round(((reference - offer.price.amountMinor) / reference) * 100));
}
