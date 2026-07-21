import { scoreOffer } from "./scoring.js";
import type { OfferSnapshot, VariantIdentityEvidence, VerifiedObservation } from "./types.js";

export interface VerifyOptions {
  delayMs?: number;
  baselineMinor?: number | null;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function canonicalRecord(record: Record<string, string>): string {
  return Object.entries(record)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${normalized(key)}=${normalized(value)}`)
    .join("|");
}

function evidenceSignature(evidence: VariantIdentityEvidence | undefined): string | null {
  if (!evidence?.expectedId || !evidence.observedId) return null;
  return [
    normalized(evidence.expectedId),
    normalized(evidence.observedId),
    evidence.expectedSource,
    evidence.observedSource,
    normalized(evidence.merchantProductId),
    normalized(evidence.gtin),
    canonicalRecord(evidence.selectedOptions),
  ].join("::");
}

export function hasExactVariantEvidence(offer: OfferSnapshot): boolean {
  const evidence = offer.variantIdentity;
  return Boolean(
    evidence?.expectedId
      && evidence.observedId
      && normalized(evidence.expectedId) === normalized(evidence.observedId)
      && evidence.expectedSource !== "unknown"
      && evidence.observedSource !== "unknown",
  );
}

function sameMoney(
  first: OfferSnapshot["shipping"] | OfferSnapshot["total"],
  second: OfferSnapshot["shipping"] | OfferSnapshot["total"],
): boolean {
  if (first === null || second === null) return first === second;
  return first.currency === second.currency && first.amountMinor === second.amountMinor;
}

function sameDelivery(first: OfferSnapshot["deliveryContext"], second: OfferSnapshot["deliveryContext"]): boolean {
  if (!first || !second) return first === second;
  return first.country === second.country
    && first.postalCode === second.postalCode
    && first.postalPrefix === second.postalPrefix
    && first.mode === second.mode
    && first.verified === second.verified;
}

function sameCart(first: OfferSnapshot["cartProbe"], second: OfferSnapshot["cartProbe"]): boolean {
  if (!first || !second) return first === second;
  return first.status === second.status
    && first.itemCents === second.itemCents
    && first.shippingCents === second.shippingCents
    && first.totalCents === second.totalCents
    && first.stockConfirmed === second.stockConfirmed
    && first.addToCartAvailable === second.addToCartAvailable
    && first.identityConfirmed === second.identityConfirmed
    && first.explicitShipping === second.explicitShipping
    && first.explicitTotal === second.explicitTotal
    && first.couponApplied === second.couponApplied;
}

export async function verifyWithSecondRead(
  read: () => Promise<OfferSnapshot>,
  options: VerifyOptions = {},
): Promise<VerifiedObservation> {
  const first = await read();
  await (options.sleep ?? defaultSleep)(options.delayMs ?? 2_500);
  const second = await read();

  const firstVariantSignature = evidenceSignature(first.variantIdentity);
  const secondVariantSignature = evidenceSignature(second.variantIdentity);
  const matchingIdentity = hasExactVariantEvidence(first)
    && hasExactVariantEvidence(second)
    && firstVariantSignature !== null
    && firstVariantSignature === secondVariantSignature
    && first.product.productKey === second.product.productKey
    && first.product.externalId === second.product.externalId;
  const matchingShipping = sameMoney(first.shipping, second.shipping);
  const matchingTotal = sameMoney(first.total, second.total);
  const matchingPrice = first.price.currency === second.price.currency
    && first.price.amountMinor === second.price.amountMinor
    && matchingShipping
    && matchingTotal;
  const matchingSeller = normalized(first.seller) === normalized(second.seller)
    && first.sellerTrusted === second.sellerTrusted;
  const matchingCondition = first.condition === second.condition;
  const matchingAvailability = first.availability === second.availability;
  const matchingDelivery = sameDelivery(first.deliveryContext, second.deliveryContext);
  const matchingCart = sameCart(first.cartProbe, second.cartProbe);
  const confirmed = matchingIdentity
    && matchingPrice
    && matchingSeller
    && matchingCondition
    && matchingAvailability
    && matchingDelivery
    && matchingCart;
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
      matchingSeller,
      matchingCondition,
      matchingAvailability,
      matchingShipping,
      matchingTotal,
      matchingDelivery,
      matchingCart,
    },
    anomaly,
  };
}

export function notificationEligible(observation: VerifiedObservation, minimumScore = 60): boolean {
  return observation.offer.fixture === false
    && observation.verification.status === "confirmed"
    && observation.verification.matchingIdentity
    && observation.verification.matchingPrice
    && observation.verification.matchingSeller !== false
    && observation.verification.matchingCondition !== false
    && observation.verification.matchingAvailability !== false
    && observation.verification.matchingShipping !== false
    && observation.verification.matchingTotal !== false
    && observation.verification.matchingDelivery !== false
    && observation.verification.matchingCart !== false
    && hasExactVariantEvidence(observation.offer)
    && observation.offer.availability !== "out_of_stock"
    && observation.offer.shipping !== null
    && observation.offer.total !== null
    && observation.offer.total.amountMinor > 0
    && observation.offer.promotion?.accessibleToAll !== false
    && observation.offer.sellerTrusted
    && observation.anomaly.score >= minimumScore
    && (observation.anomaly.classification === "probable" || observation.anomaly.classification === "strong");
}
