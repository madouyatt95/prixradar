import { scoreOffer } from "./scoring.js";
import type { OfferSnapshot, VerifiedObservation } from "./types.js";

export interface VerifyOptions {
  delayMs?: number;
  baselineMinor?: number | null;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function variantSignature(offer: OfferSnapshot) {
  const normalized = (value: string | null) => (value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  const title = normalized(offer.product.title);
  const storage = /(?:^|\D)(\d+(?:tb|to|gb|go))(?:\D|$)/u.exec(title)?.[1] ?? "";
  const color = /(noir|black|blanc|white|bleu|blue|rouge|red|vert|green|rose|pink|gris|gray|silver|argent|gold)/u.exec(title)?.[1] ?? "";
  return [normalized(offer.product.gtin), normalized(offer.product.brand), normalized(offer.product.model), storage, color, offer.condition].join(":");
}

export async function verifyWithSecondRead(
  read: () => Promise<OfferSnapshot>,
  options: VerifyOptions = {},
): Promise<VerifiedObservation> {
  const first = await read();
  await (options.sleep ?? defaultSleep)(options.delayMs ?? 2_500);
  const second = await read();

  const matchingIdentity = first.product.productKey === second.product.productKey
    && first.product.externalId === second.product.externalId
    && variantSignature(first) === variantSignature(second);
  const matchingPrice = first.price.currency === second.price.currency
    && first.price.amountMinor === second.price.amountMinor
    && first.shipping?.currency === second.shipping?.currency
    && first.shipping?.amountMinor === second.shipping?.amountMinor;
  const confirmed = matchingIdentity && matchingPrice;
  const anomaly = scoreOffer(second, options.baselineMinor);

  return {
    schemaVersion: "1",
    alertCandidateId: second.product.productKey,
    offer: { ...second, fixture: first.fixture || second.fixture },
    verification: {
      status: confirmed ? "confirmed" : "rejected",
      firstObservedAt: first.observedAt,
      secondObservedAt: second.observedAt,
      matchingPrice,
      matchingIdentity,
    },
    anomaly,
  };
}

export function notificationEligible(observation: VerifiedObservation, minimumScore = 60): boolean {
  return observation.offer.fixture === false
    && observation.verification.status === "confirmed"
    && observation.verification.matchingIdentity
    && observation.verification.matchingPrice
    && observation.offer.availability !== "out_of_stock"
    && observation.offer.shipping !== null
    && observation.offer.total !== null
    && observation.offer.total.amountMinor > 0
    && observation.offer.promotion?.accessibleToAll !== false
    && observation.offer.sellerTrusted
    && observation.anomaly.score >= minimumScore
    && (observation.anomaly.classification === "probable" || observation.anomaly.classification === "strong");
}
