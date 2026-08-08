export type SellerChannel = "retailer" | "third_party";

type SellerChannelInput = {
  source: string;
  merchant: string;
  seller: string | null;
  fulfillment?: string | null;
};

function token(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
}

const DIRECT_SELLERS: Record<string, readonly string[]> = {
  amazon: ["amazon", "amazonfr", "amazonde", "amazonit", "amazones", "amazoncouk", "amazoneu"],
  boulanger: ["boulanger", "boulangercom"],
  carrefour: ["carrefour", "carrefourfr"],
  castorama: ["castorama", "castoramafr"],
  cdiscount: ["cdiscount", "cdiscountcom"],
  conforama: ["conforama", "conforamafr"],
  darty: ["darty", "dartycom"],
  fnac: ["fnac", "fnaccom"],
  jd_sports: ["jdsports", "jdsportsfr"],
  leroy_merlin: ["leroymerlin", "leroymerlinfr"],
  rueducommerce: ["rueducommerce", "rueducommercefr"],
};

export function sellerChannel(input: SellerChannelInput): SellerChannel {
  if (input.fulfillment === "merchant" || input.fulfillment === "platform") return "third_party";
  if (input.fulfillment === "direct") return "retailer";
  const seller = token(input.seller);
  if (!seller) return "retailer";
  if (/vendeurtiers|vendeurpartenaire|marketplace|thirdparty/u.test(seller)) return "third_party";
  const direct = DIRECT_SELLERS[input.source] ?? [token(input.merchant)];
  return direct.includes(seller) || seller === token(input.merchant) ? "retailer" : "third_party";
}
