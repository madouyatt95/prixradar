import type { IntegrityObservation } from "./public-intelligence";
import { verifiedCartEvidence } from "./cart-proof.js";

type UnknownRecord = Record<string, unknown>;

export type PublicProofAlert = {
  id: string;
  source: string;
  sourceMode: string;
  merchant: string;
  market: string;
  title: string;
  brand: string | null;
  model: string | null;
  gtin: string | null;
  category: string | null;
  url: string;
  currency: string;
  priceCents: number;
  shippingCents: number | null;
  publicPriceCents: number | null;
  priceAccessibleToAll: boolean;
  promotionType: string;
  promotionLabel: string | null;
  condition: string | null;
  seller: string | null;
  score: number;
  confidence: string;
  status: string;
  evidenceJson: string;
  observedAt: string;
  verifiedAt: string | null;
  expiresAt: string | null;
};

export type PublicProofIntelligence = {
  variantJson: string;
  variantConfidence: number;
  shadowCartStatus: string;
  shadowCartJson: string;
  finalTotalCents: number | null;
  sellerScore: number;
  sellerJson: string;
  priceIndexCents: number;
  priceIndexJson: string;
  anomalyKind: string;
  anomalyJson: string;
  updatedAt: string;
};

export type PublicProofObservation = IntegrityObservation & {
  priceCents: number;
  shippingCents: number | null;
};

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function parseRecord(value: string) {
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

function boolean(value: unknown) {
  return value === true;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function string(value: unknown) {
  return typeof value === "string" ? value : null;
}

function publicHistory(points: PublicProofObservation[]) {
  return points
    .filter((point) => Number.isSafeInteger(point.priceCents) && point.priceCents >= 0 && Number.isFinite(Date.parse(point.observedAt)))
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))
    .slice(0, 30)
    .map((point) => ({
      observedAt: point.observedAt,
      priceCents: point.priceCents,
      shippingCents: point.shippingCents,
      totalCents: point.totalCents,
      available: point.available,
    }));
}

export function buildCertifiedPassport(input: {
  alert: PublicProofAlert;
  intelligence: PublicProofIntelligence | null;
  observations: PublicProofObservation[];
  integrity: unknown;
  generatedAt: string;
}) {
  const { alert, intelligence, generatedAt } = input;
  const evidence = parseRecord(alert.evidenceJson);
  const analysis = record(evidence.analysis);
  const analysisChecks = record(analysis.checks);
  const variant = intelligence ? parseRecord(intelligence.variantJson) : {};
  const variantAttributes = record(variant.attributes);
  const seller = intelligence ? parseRecord(intelligence.sellerJson) : {};
  const sellerSignals = record(seller.signals);
  const shadowCart = intelligence ? parseRecord(intelligence.shadowCartJson) : {};
  const priceIndex = intelligence ? parseRecord(intelligence.priceIndexJson) : {};
  const anomaly = intelligence ? parseRecord(intelligence.anomalyJson) : {};
  const totalCents = intelligence?.finalTotalCents
    ?? (alert.shippingCents === null ? null : alert.priceCents + alert.shippingCents);
  const liveSource = alert.sourceMode === "live";
  const secondVerification = alert.verifiedAt !== null
    && boolean(analysisChecks.secondVerification)
    && Date.parse(alert.verifiedAt) >= Date.parse(alert.observedAt);
  const exactVariant = boolean(variant.comparable)
    && (intelligence?.variantConfidence ?? 0) >= 90
    && boolean(analysisChecks.exactVariant);
  const trustedSeller = (intelligence?.sellerScore ?? 0) >= 70
    && boolean(analysisChecks.trustedSeller);
  const totalConfirmed = totalCents !== null
    && intelligence?.shadowCartStatus === "confirmed"
    && verifiedCartEvidence(intelligence.shadowCartJson);
  const publiclyAccessible = alert.priceAccessibleToAll && boolean(analysisChecks.publicPriceAccessible);
  const eligibleEvidence = evidence.notificationEligible === true;
  const checks = {
    liveSource,
    secondVerification,
    exactVariant,
    trustedSeller,
    totalConfirmed,
    publiclyAccessible,
    eligibleEvidence,
  };
  const proofComplete = Object.values(checks).every(Boolean);
  const generatedAtMs = Date.parse(generatedAt);
  const expired = alert.status === "expired"
    || (alert.expiresAt !== null && Number.isFinite(generatedAtMs) && Date.parse(alert.expiresAt) <= generatedAtMs);
  const certificationStatus = proofComplete
    ? expired ? "expired" : "certified"
    : "insufficient_evidence";
  const readings = [
    {
      sequence: 1,
      type: "initial_observation",
      observedAt: alert.observedAt,
      priceCents: alert.priceCents,
      shippingCents: alert.shippingCents,
      totalCents,
      available: analysisChecks.available !== false,
    },
    ...(secondVerification && alert.verifiedAt ? [{
      sequence: 2,
      type: "collector_verification",
      observedAt: alert.verifiedAt,
      priceCents: alert.priceCents,
      shippingCents: alert.shippingCents,
      totalCents,
      available: analysisChecks.available !== false,
    }] : []),
  ];
  const history = publicHistory(input.observations);
  const blockingReasons = Array.isArray(analysis.blockingReasons)
    ? analysis.blockingReasons.filter((reason): reason is string => typeof reason === "string").slice(0, 20)
    : [];

  return {
    id: alert.id,
    version: "2026-07-1",
    generatedAt,
    certification: {
      status: certificationStatus,
      proofId: `prx:${alert.id}:${alert.verifiedAt ?? alert.observedAt}`,
      certifiedAt: proofComplete ? alert.verifiedAt : null,
      expiresAt: alert.expiresAt,
      checks,
      limitations: [
        "preuve_applicative_non_notarisee",
        "prix_et_stock_peuvent_changer_apres_verification",
      ],
    },
    offer: {
      source: alert.source,
      merchant: alert.merchant,
      market: alert.market,
      title: alert.title,
      brand: alert.brand,
      model: alert.model,
      gtin: alert.gtin,
      category: alert.category,
      url: alert.url,
      currency: alert.currency,
      condition: alert.condition,
      promotion: {
        type: alert.promotionType,
        label: alert.promotionLabel,
        accessibleToAll: alert.priceAccessibleToAll,
      },
    },
    readings,
    history: {
      mode: "live",
      count: history.length,
      truncated: input.observations.length > history.length,
      points: history,
    },
    variant: {
      confidence: intelligence?.variantConfidence ?? null,
      comparable: boolean(variant.comparable),
      attributes: {
        gtin: string(variantAttributes.gtin) ?? alert.gtin,
        brand: string(variantAttributes.brand) ?? alert.brand,
        model: string(variantAttributes.model) ?? alert.model,
        storage: string(variantAttributes.storage),
        color: string(variantAttributes.color),
        size: string(variantAttributes.size),
        pack: number(variantAttributes.pack),
        condition: string(variantAttributes.condition) ?? alert.condition,
      },
    },
    seller: {
      name: alert.seller,
      score: intelligence?.sellerScore ?? null,
      level: string(seller.level),
      trusted: boolean(sellerSignals.trusted),
      ratingPercent: number(sellerSignals.ratingPercent),
      reviewCount: number(sellerSignals.reviewCount),
      fulfillment: string(sellerSignals.fulfillment),
      country: string(sellerSignals.country),
      warranty: typeof sellerSignals.warranty === "boolean" ? sellerSignals.warranty : null,
      returns: typeof sellerSignals.returns === "boolean" ? sellerSignals.returns : null,
    },
    total: {
      itemCents: alert.priceCents,
      publicPriceCents: alert.publicPriceCents,
      shippingCents: alert.shippingCents,
      finalTotalCents: totalCents,
      currency: alert.currency,
      cartStatus: intelligence?.shadowCartStatus ?? null,
      checkedAt: string(shadowCart.checkedAt) ?? alert.verifiedAt,
      accessibleToAll: alert.priceAccessibleToAll,
    },
    evidence: {
      anomalyScore: alert.score,
      confidence: alert.confidence,
      notificationEligible: evidence.notificationEligible === true,
      historyPoints: number(analysis.historyPoints),
      robustZ: number(analysis.robustZ),
      marketMedianCents: number(analysis.marketMedianCents) ?? intelligence?.priceIndexCents ?? null,
      marketSources: number(analysis.marketSources) ?? number(priceIndex.merchantCount) ?? 0,
      anomalyKind: intelligence?.anomalyKind ?? null,
      evidenceStrength: number(anomaly.evidenceStrength),
      blockingReasons,
    },
    integrity: input.integrity,
    methodology: {
      readings: "La seconde lecture provient du contrôle collecteur horodaté; les points historiques ne la remplacent pas.",
      redaction: "Seuls les champs nécessaires à la preuve publique sont exposés; identifiants propriétaires, secrets et empreintes brutes sont exclus.",
      certification: "Certifié exige une source LIVE, deux lectures, la variante exacte, un vendeur acceptable, le total panier et un prix accessible à tous.",
    },
  };
}
