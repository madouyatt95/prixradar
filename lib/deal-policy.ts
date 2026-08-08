export const NON_AMAZON_EXTREME_DISCOUNT_PERCENT = 70;

type DealPolicyInput = {
  source: string;
  discountPercent: number;
  currentPriceCents: number;
  usualPriceCents: number | null;
  title?: string | null;
  category?: string | null;
};

function normalized(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function isJdSportsAccessory(input: Pick<DealPolicyInput, "source" | "title" | "category">) {
  if (input.source !== "jd_sports") return false;
  const category = normalized(input.category);
  if (/\b(?:accessoire|accessoires|accessory|accessories)\b/u.test(category)) return true;
  const title = normalized(input.title);
  return /\b(?:chaussette|chaussettes|socks?|boxer|boxers|calecon|calecons|sacoche|banane|casquette|bonnet|gant|gants|portefeuille|sac a dos|backpack|ceinture|gourde)\b/u.test(title);
}

/** Amazon keeps its history-based anomaly engine. Other retailers only surface
 * an extreme public reduction backed by a real reference price. */
export function meetsPublicDealPolicy(input: DealPolicyInput) {
  if (input.source === "amazon") return true;
  if (isJdSportsAccessory(input)) return false;
  return input.usualPriceCents !== null
    && input.usualPriceCents > input.currentPriceCents
    && input.discountPercent >= NON_AMAZON_EXTREME_DISCOUNT_PERCENT;
}
