export type RetailSource = "boulanger" | "darty" | "cdiscount" | "amazon";
export type Market = "FR" | "DE" | "IT" | "ES" | "GB";
export type Currency = "EUR" | "GBP";
export type Availability = "in_stock" | "out_of_stock" | "preorder" | "unknown";
export type ExtractionStrategy = "json-ld" | "connector" | "keepa";
export type PromotionType = "public_price" | "coupon" | "membership" | "cashback" | "trade_in" | "bundle" | "unknown";

export interface Money {
  amountMinor: number;
  currency: Currency;
}

export interface ProductIdentity {
  productKey: string;
  source: RetailSource;
  market: Market;
  externalId: string;
  title: string;
  brand: string | null;
  model: string | null;
  gtin: string | null;
  category?: string | null;
  url: string;
  imageUrl: string | null;
}

export interface OfferSnapshot {
  product: ProductIdentity;
  price: Money;
  shipping: Money | null;
  /** Null means shipping is unknown; it must never be interpreted as free. */
  total: Money | null;
  referencePrice: Money | null;
  seller: string | null;
  sellerTrusted: boolean;
  condition: "new" | "used" | "refurbished" | "unknown";
  availability: Availability;
  observedAt: string;
  strategy: ExtractionStrategy;
  fixture: boolean;
  promotion?: {
    type: PromotionType;
    label: string | null;
    accessibleToAll: boolean;
  };
  deliveryContext?: {
    country: Market;
    postalCode: string;
    postalPrefix: string;
    mode: "home" | "pickup" | "either";
    verified: boolean;
  };
}

export interface VerificationEvidence {
  status: "confirmed" | "rejected";
  firstObservedAt: string;
  secondObservedAt: string;
  matchingPrice: boolean;
  matchingIdentity: boolean;
}

export interface AnomalyScore {
  score: number;
  classification: "none" | "watch" | "probable" | "strong";
  discountPercent: number | null;
  reasons: string[];
}

export interface TrustedHistoricalPrice {
  provider: "keepa";
  priceMinor: number;
  observedAt: string;
  rawHash: string;
}

export interface VerifiedObservation {
  schemaVersion: "1";
  alertCandidateId: string;
  offer: OfferSnapshot;
  verification: VerificationEvidence;
  anomaly: AnomalyScore;
  /** Bounded, provider-authenticated history. It is only ingested when shipping is explicitly free. */
  historicalPrices?: TrustedHistoricalPrice[];
}

export interface IngestResponse {
  ok: boolean;
  accepted?: boolean;
  duplicate?: boolean;
  alert?: {
    id: string;
    status: "active" | "review" | "monitoring" | "expired";
    score: number;
    confidence: string;
    notificationRequested: boolean;
    notificationEligible: boolean;
    blockingReasons: string[];
  };
}

export interface PushSubscriptionTarget {
  id: number;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  contentEncoding?: string;
  minScore?: number;
  preferences?: Record<string, unknown>;
}

export interface PushReservation {
  ok: boolean;
  reserved: boolean;
  reservationId?: number;
}

export interface SourceStatusEvent {
  source: RetailSource;
  market: Market;
  displayName: string;
  mode: "live" | "fixture";
  status: "healthy" | "degraded" | "offline" | "not_configured";
  lastSuccessAt: string | null;
  lastAttemptAt: string;
  lastErrorCode: string | null;
  productsSeen: number;
  queueLag: number;
  duplicatesSkipped?: number;
  antiBotBlocked?: boolean;
  keepaRequests?: number;
  discoverySegmentId?: string | null;
  discoveryYieldCount?: number;
  apifyCostMicros?: number | null;
}
