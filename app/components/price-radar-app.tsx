"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { AdminView } from "./admin-view";

type Tab = "radar" | "watchlist" | "sources" | "admin" | "settings";
type Confidence = "Très probable" | "Probable" | "À vérifier";
type SourceMode = "live" | "fixture";

type AlertItem = {
  id: string;
  sourceKey?: string;
  sourceMode?: SourceMode;
  title: string;
  merchant: string;
  market: string;
  source: string;
  currentPrice: number;
  usualPrice: number;
  currency: "EUR" | "GBP";
  discount: number;
  confidence: Confidence;
  score: number;
  freshness: string;
  verifiedAt: string;
  seller: string;
  condition: string;
  shipping: string;
  sku: string;
  category: string;
  label: string;
  accent: "violet" | "coral" | "mint" | "gold" | "blue";
  url: string;
  affiliateUrl?: string | null;
  reasons: string[];
  history: number[];
  priceAccessibleToAll?: boolean;
  promotionLabel?: string | null;
  marketMedian?: number | null;
  marketSources?: number;
  locationLabel?: string;
  locationVerified?: boolean;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
  observedAt?: string | null;
  expiresAt?: string | null;
  buyNow?: {
    score: number;
    label: string;
    factors: Array<{ key?: string; label?: string; points?: number; maximum?: number }>;
    cautions: string[];
  };
  community?: { total: number; positive: number; negative: number; expired: number; purchased: number };
  intelligence?: {
    variant: { fingerprint: string; confidence: number; comparable?: boolean; attributes?: Record<string, unknown> };
    shadowCart: { status: string; finalTotalCents: number | null; verified?: boolean; consistent?: boolean };
    priceIndex: { medianCents: number; bestCents?: number; merchantCount?: number; marketDiscountPercent?: number; marketPosition: string };
    anomaly: { kind: string; evidenceStrength?: number; actionable?: boolean };
    seller: { score: number; level?: string };
    lifetime: { urgencyScore: number; predictedLifetimeMinutes: number; predictedExpiresAt?: string | null };
  };
};

type InspectionState = { status: "pending" | "processing" | "completed" | "failed"; message: string; id?: string };

type RadarRule = {
  id: string;
  name: string;
  query: string;
  enabled: boolean;
};

type SourceRuntimeStatus = {
  id?: string;
  source: string;
  market?: string;
  status?: string;
  reportedStatus?: string;
  effectiveStatus?: string;
  mode?: string;
  lastSuccessAt?: string | null;
  productsSeen?: number;
  queueLag?: number;
};

type HealthCapabilities = {
  database: boolean;
  keepa: boolean;
  ingestion: boolean;
  deviceIdentity: boolean;
  pushSubscriptions: boolean;
  pushDeliveryCredentials: boolean;
};

type WatchItem = {
  productId?: string;
  id?: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const ALERTS: AlertItem[] = [
  {
    id: "boulanger-oled-c3",
    title: "TV OLED 55 pouces série C3",
    merchant: "Boulanger",
    market: "France",
    source: "Page produit + historique interne",
    currentPrice: 749,
    usualPrice: 1399,
    currency: "EUR",
    discount: 46,
    confidence: "Très probable",
    score: 94,
    freshness: "il y a 4 min",
    verifiedAt: "12:42",
    seller: "Boulanger",
    condition: "Neuf",
    shipping: "Livraison incluse",
    sku: "OLED55-C3",
    category: "Image & son",
    label: "OLED",
    accent: "violet",
    url: "https://www.boulanger.com/",
    reasons: [
      "Prix 41 % sous la médiane observée sur 90 jours",
      "Même référence et même taille vérifiées",
      "Prix encore visible lors du second contrôle",
    ],
    history: [82, 79, 81, 78, 75, 77, 73, 70, 69, 31],
  },
  {
    id: "amazon-fr-ssd-990",
    title: "SSD NVMe 2 To 990 Pro",
    merchant: "Amazon.fr",
    market: "Amazon France",
    source: "Historique Keepa · NEW",
    currentPrice: 109.99,
    usualPrice: 179.9,
    currency: "EUR",
    discount: 39,
    confidence: "Très probable",
    score: 91,
    freshness: "il y a 7 min",
    verifiedAt: "12:39",
    seller: "Amazon",
    condition: "Neuf",
    shipping: "Prime incluse",
    sku: "B0B9C4DKKG",
    category: "Informatique",
    label: "SSD",
    accent: "coral",
    url: "https://www.amazon.fr/",
    reasons: [
      "Prix inférieur au plus bas des 90 derniers jours",
      "ASIN exact, pas une variation parent",
      "Prix Amazon séparé des coupons conditionnels",
    ],
    history: [76, 74, 78, 73, 70, 72, 67, 65, 63, 38],
  },
  {
    id: "darty-dreame-l10",
    title: "Robot aspirateur L10s Ultra",
    merchant: "Darty",
    market: "France",
    source: "Page produit + comparaison marché",
    currentPrice: 389,
    usualPrice: 649,
    currency: "EUR",
    discount: 40,
    confidence: "Probable",
    score: 82,
    freshness: "il y a 12 min",
    verifiedAt: "12:34",
    seller: "Darty",
    condition: "Neuf",
    shipping: "+ 4,99 €",
    sku: "L10S-ULTRA",
    category: "Maison",
    label: "HOME",
    accent: "mint",
    url: "https://www.darty.com/",
    reasons: [
      "Écart inhabituel avec cinq vendeurs comparables",
      "Référence fabricant identique",
      "Frais de port intégrés au calcul final",
    ],
    history: [84, 79, 81, 75, 71, 67, 69, 66, 61, 42],
  },
  {
    id: "cdiscount-xm5",
    title: "Casque sans fil WH-1000XM5",
    merchant: "Cdiscount",
    market: "France",
    source: "Offre marketplace vérifiée",
    currentPrice: 229.99,
    usualPrice: 349.99,
    currency: "EUR",
    discount: 34,
    confidence: "Probable",
    score: 76,
    freshness: "il y a 18 min",
    verifiedAt: "12:28",
    seller: "Vendeur partenaire",
    condition: "Neuf",
    shipping: "+ 6,90 €",
    sku: "WH1000XM5B",
    category: "Audio",
    label: "AUDIO",
    accent: "gold",
    url: "https://www.cdiscount.com/",
    reasons: [
      "Prix total 32 % sous la médiane récente",
      "Vendeur tiers identifié : prudence recommandée",
      "Stock et frais revérifiés une fois",
    ],
    history: [80, 79, 76, 74, 77, 73, 72, 69, 66, 49],
  },
  {
    id: "amazon-de-switch-oled",
    title: "Console Switch OLED blanche",
    merchant: "Amazon.de",
    market: "Amazon Allemagne",
    source: "Historique Keepa · Buy Box",
    currentPrice: 249,
    usualPrice: 329,
    currency: "EUR",
    discount: 24,
    confidence: "Probable",
    score: 72,
    freshness: "il y a 21 min",
    verifiedAt: "12:25",
    seller: "Amazon EU",
    condition: "Neuf",
    shipping: "À confirmer vers la France",
    sku: "B098TNW7NM",
    category: "Gaming",
    label: "PLAY",
    accent: "blue",
    url: "https://www.amazon.de/",
    reasons: [
      "Baisse nette face à la moyenne Keepa sur 90 jours",
      "Devise et TVA du marché allemand conservées",
      "Éligibilité de livraison France à confirmer",
    ],
    history: [74, 72, 70, 69, 73, 68, 66, 62, 59, 48],
  },
  {
    id: "amazon-es-airfryer",
    title: "Airfryer double panier 9 L",
    merchant: "Amazon.es",
    market: "Amazon Espagne",
    source: "Historique Keepa · NEW",
    currentPrice: 99.9,
    usualPrice: 159.99,
    currency: "EUR",
    discount: 38,
    confidence: "À vérifier",
    score: 58,
    freshness: "il y a 34 min",
    verifiedAt: "12:12",
    seller: "Vendeur tiers",
    condition: "Neuf",
    shipping: "Non confirmé",
    sku: "B0C-AIR9L",
    category: "Cuisine",
    label: "COOK",
    accent: "coral",
    url: "https://www.amazon.es/",
    reasons: [
      "Baisse détectée mais offre tierce peu fraîche",
      "Frais de livraison encore inconnus",
      "Une vérification forte est nécessaire avant achat",
    ],
    history: [77, 75, 74, 76, 71, 68, 65, 64, 60, 41],
  },
];

for (const alert of ALERTS) {
  alert.buyNow = {
    score: Math.max(35, Math.min(96, Math.round(alert.score * 0.72 + alert.discount * 0.42))),
    label: alert.score >= 85 ? "Acheter maintenant" : alert.score >= 70 ? "À considérer" : "Attendre",
    factors: [],
    cautions: alert.shipping.includes("confirmer") || alert.shipping.includes("Non confirmé") ? ["Livraison à confirmer"] : [],
  };
  alert.community = { total: 0, positive: 0, negative: 0, expired: 0, purchased: 0 };
  alert.intelligence = {
    variant: { fingerprint: `demo:${alert.sku}`, confidence: alert.confidence === "Très probable" ? 94 : alert.confidence === "Probable" ? 82 : 61, comparable: alert.confidence !== "À vérifier" },
    shadowCart: { status: alert.shipping.includes("confirmer") || alert.shipping.includes("Non confirmé") ? "product_page" : "confirmed", finalTotalCents: Math.round(alert.currentPrice * 100), verified: !alert.shipping.includes("confirmer") && !alert.shipping.includes("Non confirmé"), consistent: true },
    priceIndex: { medianCents: Math.round(alert.usualPrice * 100), merchantCount: Math.max(2, alert.marketSources ?? 4), marketDiscountPercent: alert.discount, marketPosition: "best" },
    anomaly: { kind: alert.score >= 70 ? "true_anomaly" : "insufficient_evidence", evidenceStrength: alert.score, actionable: alert.score >= 70 },
    seller: { score: alert.seller.includes("tiers") || alert.seller.includes("partenaire") ? 62 : 91, level: "acceptable" },
    lifetime: { urgencyScore: Math.min(98, alert.score), predictedLifetimeMinutes: Math.max(18, 125 - alert.discount * 2) },
  };
}

const NAV_ITEMS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "radar", label: "Radar", icon: "◎" },
  { id: "watchlist", label: "Suivis", icon: "◇" },
  { id: "sources", label: "Sources", icon: "⌁" },
  { id: "admin", label: "Pilotage", icon: "◈" },
  { id: "settings", label: "Réglages", icon: "☷" },
];

const MARKET_OPTIONS = [
  { value: "FR", label: "Amazon.fr", domain: 4 },
  { value: "DE", label: "Amazon.de", domain: 3 },
  { value: "IT", label: "Amazon.it", domain: 8 },
  { value: "ES", label: "Amazon.es", domain: 9 },
  { value: "GB", label: "Amazon.co.uk", domain: 2 },
];

function money(value: number, currency: "EUR" | "GBP" = "EUR") {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function confidenceClass(confidence: Confidence) {
  if (confidence === "Très probable") return "confidence-high";
  if (confidence === "Probable") return "confidence-medium";
  return "confidence-low";
}

function anomalyLabel(kind?: string) {
  return ({
    true_anomaly: "Anomalie réelle",
    promotion: "Promotion identifiée",
    wrong_variant: "Variante incertaine",
    seller_risk: "Risque vendeur",
    conditional_price: "Prix conditionnel",
    shipping_unknown: "Livraison inconnue",
    refurbished: "Reconditionné",
    insufficient_evidence: "Preuves insuffisantes",
  } as Record<string, string>)[kind ?? ""] ?? "À qualifier";
}

function cartLabel(status?: string) {
  return status === "confirmed" ? "Panier confirmé" : status === "blocked" ? "Panier bloqué" : status === "unavailable" ? "Indisponible" : "Page vérifiée";
}

function subscribeToOnlineState(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

function readOnlineState() {
  return navigator.onLine;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function relativeTime(value: unknown) {
  if (typeof value !== "string") return "à l’instant";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "à l’instant";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
}

function alertAccent(source: string): AlertItem["accent"] {
  if (source === "amazon" || source === "keepa") return "coral";
  if (source === "boulanger") return "violet";
  if (source === "darty") return "mint";
  if (source === "cdiscount") return "blue";
  return "gold";
}

function alertLabel(source: string, title: string) {
  if (source === "amazon" || source === "keepa") return "AMZ";
  if (source === "boulanger") return "BLG";
  if (source === "darty") return "DRT";
  if (source === "cdiscount") return "CDS";
  return title.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 4).toUpperCase() || "PRIX";
}

function mapLiveAlert(value: unknown): AlertItem | null {
  const item = record(value);
  if (!item || typeof item.id !== "string" || typeof item.title !== "string") {
    return null;
  }
  const source =
    typeof item.source === "string" ? item.source.toLowerCase() : "merchant";
  const market = typeof item.market === "string" ? item.market.toUpperCase() : "FR";
  const priceCents = finite(item.priceCents);
  const usualPriceCents = finite(item.usualPriceCents, priceCents);
  const totalCents = finite(item.totalCents, priceCents);
  const evidence = record(item.evidence);
  const deliveryContext = record(item.deliveryContext);
  const buyNowRecord = record(item.buyNow);
  const communityRecord = record(item.community);
  const intelligenceRecord = record(item.intelligence);
  const variantRecord = record(intelligenceRecord?.variant);
  const cartRecord = record(intelligenceRecord?.shadowCart);
  const indexRecord = record(intelligenceRecord?.priceIndex);
  const anomalyRecord = record(intelligenceRecord?.anomaly);
  const sellerRecord = record(intelligenceRecord?.seller);
  const lifetimeRecord = record(intelligenceRecord?.lifetime);
  let reasons: string[] = [];
  if (Array.isArray(item.reasons)) {
    reasons = item.reasons.filter((reason): reason is string => typeof reason === "string");
  } else if (Array.isArray(evidence?.blockingReasons)) {
    reasons = evidence.blockingReasons.filter(
      (reason): reason is string => typeof reason === "string",
    );
  } else if (typeof item.evidenceJson === "string") {
    try {
      const parsed = record(JSON.parse(item.evidenceJson));
      if (Array.isArray(parsed?.reasons)) {
        reasons = parsed.reasons.filter(
          (reason): reason is string => typeof reason === "string",
        );
      }
    } catch {
      reasons = [];
    }
  }
  if (!reasons.length) {
    reasons = [
      "Prix total comparé à son historique récent",
      "Produit et variante contrôlés par le collecteur",
      "Seconde vérification requise avant notification",
    ];
  }
  if (typeof evidence?.marketMedianCents === "number" && finite(evidence.marketSources) >= 2) {
    reasons.unshift(`Prix comparé à ${Math.round(finite(evidence.marketSources))} enseignes · médiane ${money(finite(evidence.marketMedianCents) / 100, item.currency === "GBP" ? "GBP" : "EUR")}`);
  }
  const confidenceRaw = String(item.confidence ?? "Probable").toLowerCase();
  const confidence: Confidence = confidenceRaw.includes("très") || confidenceRaw.includes("high") || confidenceRaw === "very_likely"
    ? "Très probable"
    : confidenceRaw.includes("verify") || confidenceRaw.includes("vérifier") || confidenceRaw.includes("low") || confidenceRaw === "review"
      ? "À vérifier"
      : "Probable";
  const merchant =
    typeof item.merchant === "string"
      ? item.merchant
      : source === "amazon" || source === "keepa"
        ? `Amazon.${market === "GB" ? "co.uk" : market.toLowerCase()}`
        : source.charAt(0).toUpperCase() + source.slice(1);
  const currency = item.currency === "GBP" ? "GBP" : "EUR";
  const current = Math.max(0, totalCents / 100);
  const usual = Math.max(current, usualPriceCents / 100);
  const discount = Math.max(
    0,
    finite(
      item.discountPercent,
      usual > 0 ? Math.round((1 - current / usual) * 100) : 0,
    ),
  );
  const verified = typeof item.verifiedAt === "string" ? item.verifiedAt : item.observedAt;
  const history = Array.isArray(item.history)
    ? item.history.map((point) => finite(point)).filter((point) => point > 0).slice(-12)
    : [];

  return {
    id: item.id,
    sourceKey: source === "keepa" ? "amazon" : source,
    sourceMode: item.sourceMode === "live" ? "live" : "fixture",
    title: item.title,
    merchant,
    market: source === "amazon" || source === "keepa" ? `Amazon ${market}` : "France",
    source:
      source === "amazon" || source === "keepa"
        ? history.length > 0
          ? "Historique Keepa · vérifié"
          : "Signal Keepa · vérifié"
        : "Collecteur vérifié",
    currentPrice: current,
    usualPrice: usual,
    currency,
    discount: Math.round(discount),
    confidence,
    score: Math.round(finite(item.score, 65)),
    freshness: relativeTime(item.observedAt),
    verifiedAt:
      typeof verified === "string" && Number.isFinite(Date.parse(verified))
        ? new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(
            new Date(verified),
          )
        : "récent",
    seller: typeof item.seller === "string" ? item.seller : merchant,
    condition: typeof item.condition === "string" ? item.condition : "Neuf",
    shipping:
      item.shippingCents === null || item.shippingCents === undefined
        ? "À confirmer"
        : finite(item.shippingCents) === 0
          ? "Incluse dans ce total"
          : `${money(finite(item.shippingCents) / 100, currency)} inclus dans ce total`,
    sku: typeof item.gtin === "string" ? item.gtin : typeof item.productId === "string" ? item.productId : item.id,
    category: typeof item.category === "string" ? item.category : "Signal vérifié",
    label: alertLabel(source, item.title),
    accent: alertAccent(source),
    url: typeof item.url === "string" ? item.url : "#",
    affiliateUrl: typeof item.affiliateUrl === "string" ? item.affiliateUrl : null,
    reasons,
    history,
    priceAccessibleToAll: item.priceAccessibleToAll !== false,
    promotionLabel: typeof item.promotionLabel === "string" ? item.promotionLabel : null,
    marketMedian: typeof evidence?.marketMedianCents === "number" ? finite(evidence.marketMedianCents) / 100 : null,
    marketSources: finite(evidence?.marketSources),
    locationVerified: deliveryContext?.verified === true,
    locationLabel: deliveryContext?.verified === true
      ? `${typeof deliveryContext.country === "string" ? deliveryContext.country : ""} ${typeof deliveryContext.postalPrefix === "string" ? `${deliveryContext.postalPrefix}…` : ""}`.trim()
      : "Prix national · zone non vérifiée",
    brand: typeof item.brand === "string" ? item.brand : null,
    model: typeof item.model === "string" ? item.model : null,
    gtin: typeof item.gtin === "string" ? item.gtin : null,
    observedAt: typeof item.observedAt === "string" ? item.observedAt : null,
    expiresAt: typeof item.expiresAt === "string" ? item.expiresAt : null,
    buyNow: {
      score: Math.round(finite(buyNowRecord?.score, finite(item.score, 65))),
      label: typeof buyNowRecord?.label === "string" ? buyNowRecord.label : "À considérer",
      factors: Array.isArray(buyNowRecord?.factors)
        ? buyNowRecord.factors.filter((factor) => record(factor) !== null) as Array<{ key?: string; label?: string; points?: number; maximum?: number }>
        : [],
      cautions: Array.isArray(buyNowRecord?.cautions) ? buyNowRecord.cautions.filter((value): value is string => typeof value === "string") : [],
    },
    community: {
      total: finite(communityRecord?.total),
      positive: finite(communityRecord?.positive),
      negative: finite(communityRecord?.negative),
      expired: finite(communityRecord?.expired),
      purchased: finite(communityRecord?.purchased),
    },
    intelligence: intelligenceRecord ? {
      variant: {
        fingerprint: typeof variantRecord?.fingerprint === "string" ? variantRecord.fingerprint : `product:${item.id}`,
        confidence: Math.round(finite(variantRecord?.confidence)),
        comparable: variantRecord?.comparable === true,
        attributes: record(variantRecord?.attributes) ?? undefined,
      },
      shadowCart: {
        status: typeof cartRecord?.status === "string" ? cartRecord.status : "product_page",
        finalTotalCents: typeof cartRecord?.finalTotalCents === "number" ? cartRecord.finalTotalCents : null,
        verified: cartRecord?.verified === true,
        consistent: cartRecord?.consistent !== false,
      },
      priceIndex: {
        medianCents: finite(indexRecord?.medianCents),
        bestCents: typeof indexRecord?.bestCents === "number" ? indexRecord.bestCents : undefined,
        merchantCount: finite(indexRecord?.merchantCount),
        marketDiscountPercent: finite(indexRecord?.marketDiscountPercent),
        marketPosition: typeof indexRecord?.marketPosition === "string" ? indexRecord.marketPosition : "market",
      },
      anomaly: {
        kind: typeof anomalyRecord?.kind === "string" ? anomalyRecord.kind : "insufficient_evidence",
        evidenceStrength: finite(anomalyRecord?.evidenceStrength),
        actionable: anomalyRecord?.actionable === true,
      },
      seller: { score: finite(sellerRecord?.score), level: typeof sellerRecord?.level === "string" ? sellerRecord.level : undefined },
      lifetime: {
        urgencyScore: finite(lifetimeRecord?.urgencyScore),
        predictedLifetimeMinutes: finite(lifetimeRecord?.predictedLifetimeMinutes),
        predictedExpiresAt: typeof lifetimeRecord?.predictedExpiresAt === "string" ? lifetimeRecord.predictedExpiresAt : null,
      },
    } : undefined,
  };
}

function urlBase64ToBytes(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = window.atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function PriceRadarApp() {
  const [tab, setTab] = useState<Tab>("radar");
  const [filter, setFilter] = useState("Tout");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AlertItem | null>(null);
  const [liveAlerts, setLiveAlerts] = useState<AlertItem[]>([]);
  const [liveLoading, setLiveLoading] = useState(true);
  const [sourceStatuses, setSourceStatuses] = useState<SourceRuntimeStatus[]>([]);
  const [health, setHealth] = useState<HealthCapabilities | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [watchLoading, setWatchLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [inspection, setInspection] = useState<InspectionState | null>(null);
  const online = useSyncExternalStore(
    subscribeToOnlineState,
    readOnlineState,
    () => true,
  );
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupAsin, setLookupAsin] = useState("");
  const [lookupMarket, setLookupMarket] = useState("FR");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const [lookupError, setLookupError] = useState("");
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [notificationState, setNotificationState] = useState(() => {
    if (typeof Notification === "undefined") return "Non prises en charge";
    return Notification.permission === "granted"
      ? "Autorisées"
      : Notification.permission === "denied"
        ? "Bloquées"
        : "Non activées";
  });
  const [minScore, setMinScore] = useState(75);
  const [quietHours, setQuietHours] = useState(true);
  const [minDiscount, setMinDiscount] = useState(20);
  const [maxPriceEuros, setMaxPriceEuros] = useState("");
  const [preferredMarkets, setPreferredMarkets] = useState("FR");
  const [preferredCategories, setPreferredCategories] = useState("");
  const [deliveryCountry, setDeliveryCountry] = useState("FR");
  const [postalCode, setPostalCode] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<"home" | "pickup" | "either">("either");
  const [requireLocationMatch, setRequireLocationMatch] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [affiliateConsent, setAffiliateConsent] = useState(false);
  const [notificationSpeed, setNotificationSpeed] = useState<"instant" | "balanced" | "digest">("balanced");
  const [radarRules, setRadarRules] = useState<RadarRule[]>([]);
  const [radarQuery, setRadarQuery] = useState("");
  const [radarSaving, setRadarSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

    const installHandler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", installHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", installHandler);
    };
  }, []);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetch("/api/alerts?limit=50", { headers: { accept: "application/json" } }).then(
        async (response) => {
          if (!response.ok) return [];
          const data = (await response.json()) as Record<string, unknown>;
          const items = Array.isArray(data.items)
            ? data.items
            : Array.isArray(data.alerts)
              ? data.alerts
              : [];
          return items.map(mapLiveAlert).filter((item): item is AlertItem => item !== null);
        },
      ),
      fetch("/api/sources", { headers: { accept: "application/json" } }).then(
        async (response) => {
          if (!response.ok) return [];
          const data = (await response.json()) as Record<string, unknown>;
          const items = Array.isArray(data.items)
            ? data.items
            : Array.isArray(data.sources)
              ? data.sources
              : [];
          return items
            .map((item) => record(item))
            .filter((item): item is Record<string, unknown> => item !== null)
            .map((item) => ({
              id: typeof item.id === "string" ? item.id : undefined,
              source: typeof item.source === "string" ? item.source : "unknown",
              market: typeof item.market === "string" ? item.market : undefined,
              status:
                typeof item.effectiveStatus === "string"
                  ? item.effectiveStatus
                  : typeof item.reportedStatus === "string"
                    ? item.reportedStatus
                    : typeof item.status === "string"
                      ? item.status
                      : undefined,
              reportedStatus:
                typeof item.reportedStatus === "string" ? item.reportedStatus : undefined,
              effectiveStatus:
                typeof item.effectiveStatus === "string" ? item.effectiveStatus : undefined,
              mode: typeof item.mode === "string" ? item.mode : undefined,
              lastSuccessAt:
                typeof item.lastSuccessAt === "string" ? item.lastSuccessAt : null,
              productsSeen: finite(item.productsSeen),
              queueLag: finite(item.queueLag),
            }));
        },
      ),
      fetch("/api/health", { headers: { accept: "application/json" } }).then(
        async (response) => {
          const data = (await response.json()) as Record<string, unknown>;
          const capabilities = record(data.capabilities);
          if (!capabilities) return null;
          return {
            database: capabilities.database === true,
            keepa: capabilities.keepa === true,
            ingestion: capabilities.ingestion === true,
            deviceIdentity: capabilities.deviceIdentity === true,
            pushSubscriptions: capabilities.pushSubscriptions === true,
            pushDeliveryCredentials: capabilities.pushDeliveryCredentials === true,
          } satisfies HealthCapabilities;
        },
      ),
    ]).then(([alertsResult, sourcesResult, healthResult]) => {
      if (!active) return;
      if (alertsResult.status === "fulfilled") setLiveAlerts(alertsResult.value);
      if (sourcesResult.status === "fulfilled") setSourceStatuses(sourcesResult.value);
      if (healthResult.status === "fulfilled") setHealth(healthResult.value);
      setLiveLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/preferences", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = (await response.json()) as Record<string, unknown>;
        return record(data.preferences) ?? record(data.item) ?? data;
      })
      .then((preferences) => {
        if (!active || !preferences) return;
        if (typeof preferences.minScore === "number") {
          setMinScore(Math.max(60, Math.min(95, preferences.minScore)));
        }
        if (typeof preferences.quietHours === "boolean") {
          setQuietHours(preferences.quietHours);
        }
        if (typeof preferences.minDiscount === "number") setMinDiscount(preferences.minDiscount);
        if (typeof preferences.maxPriceCents === "number") setMaxPriceEuros(String(preferences.maxPriceCents / 100));
        if (Array.isArray(preferences.markets)) setPreferredMarkets(preferences.markets.join(", "));
        if (Array.isArray(preferences.categories)) setPreferredCategories(preferences.categories.join(", "));
        if (typeof preferences.deliveryCountry === "string") setDeliveryCountry(preferences.deliveryCountry);
        if (typeof preferences.postalCode === "string") setPostalCode(preferences.postalCode);
        if (preferences.deliveryMode === "home" || preferences.deliveryMode === "pickup" || preferences.deliveryMode === "either") setDeliveryMode(preferences.deliveryMode);
        if (typeof preferences.requireLocationMatch === "boolean") setRequireLocationMatch(preferences.requireLocationMatch);
        if (preferences.notificationSpeed === "instant" || preferences.notificationSpeed === "balanced" || preferences.notificationSpeed === "digest") setNotificationSpeed(preferences.notificationSpeed);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setPreferencesReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    const timer = window.setTimeout(() => {
      fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          minScore,
          quietHours,
          minDiscount,
          maxPriceCents: maxPriceEuros.trim() ? Math.max(1, Math.round(Number(maxPriceEuros) * 100)) : null,
          markets: preferredMarkets.split(",").map((item) => item.trim()).filter(Boolean),
          categories: preferredCategories.split(",").map((item) => item.trim()).filter(Boolean),
          deliveryCountry,
          postalCode,
          deliveryMode,
          requireLocationMatch,
          notificationSpeed,
        }),
      }).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [deliveryCountry, deliveryMode, maxPriceEuros, minDiscount, minScore, notificationSpeed, postalCode, preferredCategories, preferredMarkets, preferencesReady, quietHours, requireLocationMatch]);

  useEffect(() => {
    fetch("/api/radars", { headers: { accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data: unknown) => {
        const items = record(data)?.items;
        if (Array.isArray(items)) setRadarRules(items.flatMap((item): RadarRule[] => {
          const value = record(item);
          return value && typeof value.id === "string" && typeof value.query === "string"
            ? [{ id: value.id, name: typeof value.name === "string" ? value.name : value.query, query: value.query, enabled: value.enabled !== false }]
            : [];
        }));
      }).catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/consent", { headers: { accept: "application/json" } }).then(async (response) => response.ok ? response.json() : null).then((data: unknown) => {
      const consent = record(record(data)?.consent);
      if (consent) {
        setAnalyticsConsent(consent.analytics === true);
        setAffiliateConsent(consent.affiliateLinks === true);
      }
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    const timer = window.setTimeout(() => {
      fetch("/api/consent", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ analytics: analyticsConsent, affiliateLinks: affiliateConsent }) }).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [affiliateConsent, analyticsConsent, preferencesReady]);

  useEffect(() => {
    let active = true;
    fetch("/api/watchlist", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) return [];
        const data = (await response.json()) as {
          items?: WatchItem[];
          watchlist?: WatchItem[];
        };
        return data.items ?? data.watchlist ?? [];
      })
      .then((items) => {
        if (!active) return;
        setWatched(
          new Set(
            items
              .map((item) => item.productId ?? item.id)
              .filter((id): id is string => Boolean(id)),
          ),
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setWatchLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);

  useEffect(() => {
    const requested = new URL(window.location.href).searchParams.get("alert");
    if (!requested || selected) return;
    const match = [...liveAlerts, ...ALERTS].find((alert) => alert.id === requested);
    if (match) window.setTimeout(() => setSelected(match), 0);
  }, [liveAlerts, selected]);

  useEffect(() => {
    const location = new URL(window.location.href);
    const sharedUrl = location.searchParams.get("inspect");
    if (!sharedUrl) {
      if (location.searchParams.get("inspectError")) {
        window.setTimeout(() => setInspection({ status: "failed", message: "Ce lien ne vient pas d’une enseigne prise en charge." }), 0);
      }
      return;
    }
    let active = true;
    let timer = 0;
    const cleanAddress = () => {
      const next = new URL(window.location.href);
      next.searchParams.delete("inspect");
      next.searchParams.delete("inspectError");
      window.history.replaceState({}, "", next);
    };
    const poll = async (id: string, attempt = 0): Promise<void> => {
      if (!active) return;
      try {
        const response = await fetch(`/api/inspections?id=${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
        const payload = await response.json() as { items?: Array<{ status?: string; result?: Record<string, unknown> }> };
        const item = payload.items?.[0];
        if (item?.status === "completed") {
          const title = typeof item.result?.title === "string" ? item.result.title : "offre partagée";
          setInspection({ status: "completed", id, message: `${title} a été contrôlée : panier, variante, vendeur et indice PrixRadar.` });
          setSearch(title === "offre partagée" ? "" : title);
          const refreshed = await fetch("/api/alerts?limit=50", { headers: { accept: "application/json" } });
          if (refreshed.ok) {
            const data = await refreshed.json() as { items?: unknown[] };
            const mapped = (data.items ?? []).map(mapLiveAlert).filter((value): value is AlertItem => value !== null);
            if (active) setLiveAlerts(mapped);
          }
          cleanAddress();
          return;
        }
        if (item?.status === "failed") throw new Error("La page marchande n’a pas pu être contrôlée.");
        setInspection({ status: item?.status === "processing" ? "processing" : "pending", id, message: item?.status === "processing" ? "PrixRadar relit la page et teste le panier sans acheter…" : "Lien ajouté à la file prioritaire…" });
        if (attempt < 20) timer = window.setTimeout(() => void poll(id, attempt + 1), 3_000);
        else setInspection({ status: "pending", id, message: "Contrôle conservé en arrière-plan. Le résultat apparaîtra automatiquement au prochain passage." });
      } catch (error) {
        setInspection({ status: "failed", id, message: error instanceof Error ? error.message : "Inspection indisponible." });
        cleanAddress();
      }
    };
    void fetch("/api/inspections", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ url: sharedUrl }),
    }).then(async (response) => {
      const payload = await response.json() as { item?: { id?: string }; message?: string };
      if (!response.ok || !payload.item?.id) throw new Error(payload.message ?? "Ce lien ne peut pas être inspecté.");
      if (active) {
        setInspection({ status: "pending", id: payload.item.id, message: "Lien reçu. Contrôle autonome prioritaire lancé…" });
        await poll(payload.item.id);
      }
    }).catch((error) => {
      if (active) setInspection({ status: "failed", message: error instanceof Error ? error.message : "Inspection indisponible." });
      cleanAddress();
    });
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  const activeAlerts = useMemo(
    () => (liveAlerts.length ? liveAlerts : ALERTS),
    [liveAlerts],
  );
  const hasLiveSources = useMemo(
    () =>
      sourceStatuses.some(
        (source) =>
          source.mode === "live" && source.effectiveStatus?.toLowerCase() === "healthy",
      ),
    [sourceStatuses],
  );

  const visibleAlerts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("fr");
    return activeAlerts.filter((alert) => {
      const filterMatch =
        filter === "Tout" ||
        (filter === "Très probable" && alert.confidence === "Très probable") ||
        (filter === "Prix public" && alert.priceAccessibleToAll !== false) ||
        (filter === "Remise ≥ 30 %" && alert.discount >= 30) ||
        (filter === "Budget ≤ 250 €" && alert.currency === "EUR" && alert.currentPrice <= 250) ||
        (filter === "Amazon · Keepa" && alert.source.includes("Keepa")) ||
        (filter === "France" && alert.market.includes("France")) ||
        (filter.startsWith("Catégorie · ") && alert.category === filter.slice("Catégorie · ".length));
      const searchMatch =
        !query ||
        `${alert.title} ${alert.merchant} ${alert.category} ${alert.sku} ${alert.brand ?? ""} ${alert.model ?? ""}`
          .toLocaleLowerCase("fr")
          .includes(query);
      return filterMatch && searchMatch;
    });
  }, [activeAlerts, filter, search]);

  const knownAlerts = [...liveAlerts, ...ALERTS].filter(
    (alert, index, all) => all.findIndex((candidate) => candidate.id === alert.id) === index,
  );
  const watchedAlerts = knownAlerts.filter((alert) => watched.has(alert.id));

  async function toggleWatch(alert: AlertItem) {
    const isWatched = watched.has(alert.id);
    const source =
      alert.sourceKey ??
      (alert.merchant.startsWith("Amazon")
        ? "amazon"
        : alert.merchant.toLowerCase());
    const marketMatch = alert.market.match(/\b(FR|DE|IT|ES|GB)\b/i);
    const market = marketMatch?.[1]?.toUpperCase() ??
      (alert.merchant.endsWith(".de")
        ? "DE"
        : alert.merchant.endsWith(".es")
          ? "ES"
          : alert.merchant.endsWith(".it")
            ? "IT"
            : alert.merchant.endsWith(".co.uk")
              ? "GB"
              : "FR");
    setWatched((current) => {
      const next = new Set(current);
      if (isWatched) next.delete(alert.id);
      else next.add(alert.id);
      return next;
    });

    try {
      const response = await fetch(
        isWatched
          ? `/api/watchlist?productId=${encodeURIComponent(alert.id)}&source=${source}&market=${market}`
          : "/api/watchlist",
        {
          method: isWatched ? "DELETE" : "POST",
          headers: isWatched
            ? { accept: "application/json" }
            : { "content-type": "application/json", accept: "application/json" },
          body: isWatched
            ? undefined
            : JSON.stringify({
                productId: alert.id,
                source,
                title: alert.title,
                market,
                priceCents: Math.round(alert.currentPrice * 100),
                url: alert.url,
              }),
        },
      );
      if (!response.ok) throw new Error("persistence");
      setToast(isWatched ? "Retiré de vos suivis" : "Ajouté à vos suivis");
    } catch {
      setWatched((current) => {
        const next = new Set(current);
        if (isWatched) next.add(alert.id);
        else next.delete(alert.id);
        return next;
      });
      setToast("Impossible d’enregistrer pour le moment");
    }
  }

  async function submitFeedback(alert: AlertItem, verdict: "useful" | "false_positive" | "expired" | "purchased" | "cancelled" | "wrong_variant" | "coupon_failed" | "price_confirmed") {
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ alertId: alert.id, verdict }),
      });
      if (!response.ok) throw new Error("feedback");
      const labels: Record<typeof verdict, string> = {
        useful: "Merci, bonne alerte enregistrée", false_positive: "Faux positif enregistré", expired: "Prix expiré signalé",
        purchased: "Achat confirmé", cancelled: "Annulation signalée", wrong_variant: "Mauvaise variante signalée",
        coupon_failed: "Coupon inutilisable signalé", price_confirmed: "Prix confirmé sur la page finale",
      };
      setToast(labels[verdict]);
    } catch {
      setToast(alert.sourceMode === "live" ? "Impossible d’enregistrer cet avis" : "Les avis concernent les alertes actives");
    }
  }

  async function createRadar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = radarQuery.trim();
    if (query.length < 3) return setToast("Décrivez le produit, le budget ou la remise souhaitée");
    setRadarSaving(true);
    try {
      const response = await fetch("/api/radars", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await response.json() as { item?: RadarRule; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error ?? "Radar invalide");
      setRadarRules((current) => [data.item as RadarRule, ...current]);
      setRadarQuery("");
      setToast("Radar personnel activé");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Impossible de créer ce radar");
    } finally {
      setRadarSaving(false);
    }
  }

  async function deleteRadar(id: string) {
    const response = await fetch(`/api/radars?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) {
      setRadarRules((current) => current.filter((rule) => rule.id !== id));
      setToast("Radar supprimé");
    } else setToast("Suppression impossible");
  }

  async function lookupKeepa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asin = lookupAsin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      setLookupError("Saisissez un ASIN Amazon valide de 10 caractères.");
      return;
    }
    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);
    try {
      const response = await fetch(
        `/api/keepa?asin=${encodeURIComponent(asin)}&market=${lookupMarket}`,
        { headers: { accept: "application/json" } },
      );
      const data = (await response.json()) as Record<string, unknown> & {
        error?: string | { message?: string };
        message?: string;
      };
      if (!response.ok) {
        const apiMessage =
          typeof data.error === "string"
            ? data.error
            : data.error?.message ?? data.message;
        throw new Error(apiMessage || "Keepa n’est pas disponible.");
      }
      setLookupResult(data);
    } catch (error) {
      setLookupError(
        error instanceof Error
          ? error.message
          : "La vérification Keepa a échoué.",
      );
    } finally {
      setLookupLoading(false);
    }
  }

  async function requestNotifications() {
    if (!("Notification" in window)) {
      setToast("Les notifications ne sont pas prises en charge ici");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationState(
      permission === "granted"
        ? "Autorisées"
        : permission === "denied"
          ? "Bloquées"
          : "Non activées",
    );
    if (permission === "granted") {
      const registration = await navigator.serviceWorker?.ready;
      if (registration) {
        try {
          const configResponse = await fetch("/api/push", {
            headers: { accept: "application/json" },
          });
          if (configResponse.ok) {
            const config = (await configResponse.json()) as Record<string, unknown>;
            const nestedConfig = record(config.config);
            const publicKey =
              (typeof config.publicKey === "string" && config.publicKey) ||
              (typeof config.vapidPublicKey === "string" && config.vapidPublicKey) ||
              (typeof nestedConfig?.publicKey === "string" && nestedConfig.publicKey) ||
              null;
            if (publicKey && "pushManager" in registration) {
              const subscription =
                (await registration.pushManager.getSubscription()) ??
                (await registration.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: urlBase64ToBytes(publicKey),
                }));
              const serialized = subscription.toJSON();
              const saved = await fetch("/api/push", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  accept: "application/json",
                },
                body: JSON.stringify({
                  endpoint: serialized.endpoint,
                  expirationTime: serialized.expirationTime,
                  keys: serialized.keys,
                  contentEncoding: "aes128gcm",
                }),
              });
              if (saved.ok) setNotificationState("Alertes push actives");
            } else {
              setNotificationState("Autorisées · envoi à connecter");
            }
          }
        } catch {
          setNotificationState("Autorisées · envoi à connecter");
        }
        await registration.showNotification("PrixRadar est prêt", {
          body: "Vous pourrez recevoir ici les anomalies réellement confirmées.",
          icon: "/icon-192.png",
          tag: "prixradar-test",
        });
      }
      setToast("Notification de test envoyée");
    }
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setToast(
        choice.outcome === "accepted"
          ? "PrixRadar est installé"
          : "Installation annulée",
      );
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    setToast("Sur iPhone : Partager, puis Sur l’écran d’accueil");
  }

  function renderTab() {
    if (tab === "admin") return <AdminView />;
    if (tab === "watchlist") {
      return (
        <WatchlistView
          alerts={watchedAlerts}
          loading={watchLoading}
          onOpen={setSelected}
          onRemove={toggleWatch}
          onExplore={() => setTab("radar")}
        />
      );
    }
    if (tab === "sources") {
      return (
        <SourcesView
          lookupOpen={lookupOpen}
          setLookupOpen={setLookupOpen}
          asin={lookupAsin}
          setAsin={setLookupAsin}
          market={lookupMarket}
          setMarket={setLookupMarket}
          loading={lookupLoading}
          result={lookupResult}
          error={lookupError}
          onSubmit={lookupKeepa}
          statuses={sourceStatuses}
          health={health}
          liveAlertCount={liveAlerts.length}
        />
      );
    }
    if (tab === "settings") {
      return (
        <SettingsView
          notificationState={notificationState}
          onNotifications={requestNotifications}
          minScore={minScore}
          setMinScore={setMinScore}
          quietHours={quietHours}
          setQuietHours={setQuietHours}
          minDiscount={minDiscount}
          setMinDiscount={setMinDiscount}
          maxPriceEuros={maxPriceEuros}
          setMaxPriceEuros={setMaxPriceEuros}
          preferredMarkets={preferredMarkets}
          setPreferredMarkets={setPreferredMarkets}
          preferredCategories={preferredCategories}
          setPreferredCategories={setPreferredCategories}
          deliveryCountry={deliveryCountry}
          setDeliveryCountry={setDeliveryCountry}
          postalCode={postalCode}
          setPostalCode={setPostalCode}
          deliveryMode={deliveryMode}
          setDeliveryMode={setDeliveryMode}
          requireLocationMatch={requireLocationMatch}
          setRequireLocationMatch={setRequireLocationMatch}
          analyticsConsent={analyticsConsent}
          setAnalyticsConsent={setAnalyticsConsent}
          affiliateConsent={affiliateConsent}
          setAffiliateConsent={setAffiliateConsent}
          notificationSpeed={notificationSpeed}
          setNotificationSpeed={setNotificationSpeed}
          onInstall={installApp}
          installReady={Boolean(installPrompt)}
        />
      );
    }
    return (
      <RadarView
        alerts={visibleAlerts}
        filter={filter}
        setFilter={setFilter}
        search={search}
        setSearch={setSearch}
        searchRef={searchRef}
        watched={watched}
        onWatch={toggleWatch}
        onOpen={setSelected}
        mode={liveAlerts.length ? "live" : "fixture"}
        loading={liveLoading}
        onLookup={() => {
          setTab("sources");
          setLookupOpen(true);
        }}
        radarRules={radarRules}
        radarQuery={radarQuery}
        setRadarQuery={setRadarQuery}
        radarSaving={radarSaving}
        onCreateRadar={createRadar}
        onDeleteRadar={deleteRadar}
        onScan={() => setScannerOpen(true)}
      />
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <aside className="desktop-rail" aria-label="Navigation principale">
        <BrandMark compact={false} />
        <nav className="rail-nav">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`rail-link ${tab === item.id ? "is-active" : ""}`}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id === "watchlist" && watched.size > 0 ? (
                <span className="nav-count">{watched.size}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className={`rail-foot ${hasLiveSources ? "is-live" : ""}`}>
          <span className="pulse-dot" />
          <div>
            <strong>{hasLiveSources ? "Surveillance active" : "Mode démo"}</strong>
            <small>
              {liveAlerts.length
                ? `${liveAlerts.length} anomalie${liveAlerts.length > 1 ? "s" : ""} vérifiée${liveAlerts.length > 1 ? "s" : ""}`
                : hasLiveSources
                  ? "Aucune anomalie confirmée"
                  : "Connecteurs à configurer"}
            </small>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="mobile-header">
          <BrandMark compact />
          <button
            type="button"
            className="round-button"
            aria-label="Rechercher"
            onClick={() => {
              setTab("radar");
              window.setTimeout(() => searchRef.current?.focus(), 30);
            }}
          >
            ⌕
          </button>
        </header>

        {!online ? (
          <div className="offline-banner" role="status">
            Hors ligne · vos derniers écrans restent disponibles
          </div>
        ) : null}

        <div className={`demo-banner ${hasLiveSources ? "live-banner" : ""}`} role="note">
          <span className="demo-badge">{hasLiveSources ? "LIVE" : "DÉMO"}</span>
          <span>
            {liveAlerts.length
              ? `${liveAlerts.length} anomalie${liveAlerts.length > 1 ? "s" : ""} issue${liveAlerts.length > 1 ? "s" : ""} de collectes réelles et revérifiées.`
              : hasLiveSources
                ? "Collecteurs actifs, aucune anomalie confirmée. Les cartes DÉMO restent affichées comme exemples."
                : "Prix illustratifs, aucun achat réel. Les sources attendent leurs accès pour passer en surveillance active."}
          </span>
        </div>

        {inspection ? (
          <div className={`inspection-banner is-${inspection.status}`} role="status">
            <span className="inspection-pulse" aria-hidden="true" />
            <div><strong>{inspection.status === "completed" ? "Inspection terminée" : inspection.status === "failed" ? "Inspection impossible" : "Sentinelle prioritaire"}</strong><p>{inspection.message}</p></div>
            <button type="button" onClick={() => setInspection(null)} aria-label="Fermer">×</button>
          </div>
        ) : null}

        <main id="main-content" className="content-area">
          {renderTab()}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navigation principale">
        {NAV_ITEMS.map((item) => (
          <button
            type="button"
            key={item.id}
            className={tab === item.id ? "is-active" : ""}
            onClick={() => setTab(item.id)}
            aria-current={tab === item.id ? "page" : undefined}
          >
            <span className="mobile-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
            {item.id === "watchlist" && watched.size > 0 ? (
              <span className="mobile-count">{watched.size}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {selected ? (
        <AlertDetail
          alert={selected}
          watched={watched.has(selected.id)}
          onWatch={() => toggleWatch(selected)}
          onFeedback={(verdict) => void submitFeedback(selected, verdict)}
          useAffiliateLink={affiliateConsent}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {scannerOpen ? <BarcodeScanner onClose={() => setScannerOpen(false)} onDetected={(code) => {
        setSearch(code);
        setFilter("Tout");
        setTab("radar");
        setScannerOpen(false);
        setToast(`EAN ${code} recherché dans les alertes`);
      }} /> : null}

      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function BrandMark({ compact }: { compact: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <span className="radar-mark" aria-hidden="true">
        <span />
      </span>
      <span className="brand-word">
        Prix<span>Radar</span>
      </span>
      {!compact ? <small>Les baisses qui méritent un regard.</small> : null}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function RadarView({
  alerts,
  filter,
  setFilter,
  search,
  setSearch,
  searchRef,
  watched,
  onWatch,
  onOpen,
  onLookup,
  mode,
  loading,
  radarRules,
  radarQuery,
  setRadarQuery,
  radarSaving,
  onCreateRadar,
  onDeleteRadar,
  onScan,
}: {
  alerts: AlertItem[];
  filter: string;
  setFilter: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  watched: Set<string>;
  onWatch: (alert: AlertItem) => void;
  onOpen: (alert: AlertItem) => void;
  onLookup: () => void;
  mode: SourceMode;
  loading: boolean;
  radarRules: RadarRule[];
  radarQuery: string;
  setRadarQuery: (value: string) => void;
  radarSaving: boolean;
  onCreateRadar: (event: FormEvent<HTMLFormElement>) => void;
  onDeleteRadar: (id: string) => void;
  onScan: () => void;
}) {
  const categories = [...new Set(alerts.map((alert) => alert.category))].slice(0, 3);
  const filters = ["Tout", "Prix public", "Très probable", "Remise ≥ 30 %", "Budget ≤ 250 €", "Amazon · Keepa", "France", ...categories.map((category) => `Catégorie · ${category}`)];
  const verifiedCount = alerts.filter((alert) => alert.score >= 75).length;
  const medianDiscount = alerts.length
    ? [...alerts].sort((a, b) => a.discount - b.discount)[Math.floor(alerts.length / 2)]
        .discount
    : 0;
  return (
    <section className="view-section">
      <PageHeading
        eyebrow={mode === "live" ? "Surveillance connectée" : "Aperçu de démonstration"}
        title={
          loading
            ? "Le radar synchronise ses sources"
            : mode === "live"
              ? `Le radar a confirmé ${alerts.length} anomalie${alerts.length > 1 ? "s" : ""}`
              : "Voici comment seront classées vos alertes"
        }
        description={
          mode === "live"
            ? "Ces prix proviennent des collecteurs, puis passent les contrôles de fraîcheur, variante, vendeur et livraison."
            : "Ces cartes illustrent le produit final. Elles ne représentent aucun prix actuellement disponible."
        }
        action={
          <div className="heading-actions"><button type="button" className="secondary-button" onClick={onScan}><span aria-hidden="true">▦</span> Scanner EAN</button><button type="button" className="primary-button" onClick={onLookup}><span aria-hidden="true">＋</span> Vérifier un ASIN</button></div>
        }
      />

      <section className="natural-radar" aria-labelledby="natural-radar-title">
        <div><span className="eyebrow">Alerte en langage naturel</span><h2 id="natural-radar-title">Dites simplement ce que vous cherchez</h2><p>Exemple : « un iPhone neuf sous 850 €, livré en France, avec au moins 25 % de remise ».</p></div>
        <form onSubmit={onCreateRadar}><input value={radarQuery} onChange={(event) => setRadarQuery(event.target.value)} maxLength={300} placeholder="Un OLED 55 pouces sous 800 €…" aria-label="Description du radar personnel" /><button className="dark-button" disabled={radarSaving}>{radarSaving ? "Activation…" : "Activer ce radar"}</button></form>
        {radarRules.length > 0 ? <div className="radar-rule-list" aria-label="Radars actifs">{radarRules.map((rule) => <span key={rule.id}><i aria-hidden="true" />{rule.name}<button type="button" onClick={() => onDeleteRadar(rule.id)} aria-label={`Supprimer ${rule.name}`}>×</button></span>)}</div> : null}
      </section>

      <div className="metric-row" aria-label="Résumé du radar">
        <div className="metric-card metric-primary">
          <span>{mode === "live" ? "Anomalies actives" : "Exemples de signaux"}</span>
          <strong>{loading ? "…" : alerts.length}</strong>
          <small>{mode === "live" ? "après seconde vérification" : "sur 4 enseignes + Amazon"}</small>
        </div>
        <div className="metric-card">
          <span>Doublement vérifiés</span>
          <strong>{loading ? "…" : verifiedCount}</strong>
          <small>prêts à être notifiés</small>
        </div>
        <div className="metric-card">
          <span>Économie médiane</span>
          <strong>{loading ? "…" : `−${medianDiscount} %`}</strong>
          <small>sur les signaux affichés</small>
        </div>
      </div>

      <div className="toolbar">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Rechercher un produit ou une enseigne</span>
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Produit, enseigne, catégorie…"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Effacer la recherche"
            >
              ×
            </button>
          ) : null}
        </label>
        <div className="filter-scroll" aria-label="Filtrer les signaux">
          {filters.map((item) => (
            <button
              type="button"
              key={item}
              className={filter === item ? "is-active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="section-label-row">
        <h2>{mode === "live" ? "Anomalies en cours" : "Signaux de démonstration"}</h2>
        <span>{alerts.length} résultats</span>
      </div>
      {alerts.length ? (
        <div className="alert-grid">
          {alerts.map((alert, index) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              featured={index === 0}
              watched={watched.has(alert.id)}
              onWatch={() => onWatch(alert)}
              onOpen={() => onOpen(alert)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-radar" aria-hidden="true" />
          <h2>Aucun signal dans ce filtre</h2>
          <p>Essayez une autre enseigne ou effacez votre recherche.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setFilter("Tout");
              setSearch("");
            }}
          >
            Tout afficher
          </button>
        </div>
      )}
    </section>
  );
}

function AlertCard({
  alert,
  featured,
  watched,
  onWatch,
  onOpen,
}: {
  alert: AlertItem;
  featured: boolean;
  watched: boolean;
  onWatch: () => void;
  onOpen: () => void;
}) {
  return (
    <article className={`alert-card ${featured ? "is-featured" : ""}`}>
      <button
        type="button"
        className="card-main-button"
        onClick={onOpen}
        aria-label={`Voir l’analyse de ${alert.title}`}
      >
        <div className={`product-tile accent-${alert.accent}`} aria-hidden="true">
          <span>{alert.label}</span>
          <i />
        </div>
        <div className="card-content">
          <div className="card-meta">
            <span className="card-meta-left">
              <span className="merchant-pill">{alert.merchant}</span>
              <span className={`signal-mode ${alert.sourceMode === "live" ? "is-live" : ""}`}>
                {alert.sourceMode === "live" ? "LIVE" : "DÉMO"}
              </span>
            </span>
            <span>{alert.freshness}</span>
          </div>
          <h3>{alert.title}</h3>
          <p className="card-source">{alert.source}</p>
          {alert.intelligence ? <div className="autonomy-badges"><span>{cartLabel(alert.intelligence.shadowCart.status)}</span><span>Variante {alert.intelligence.variant.confidence}%</span><span>Urgence {alert.intelligence.lifetime.urgencyScore}/100</span></div> : null}
          <div className="price-line">
            <strong>{money(alert.currentPrice, alert.currency)}</strong>
            <del>{money(alert.usualPrice, alert.currency)}</del>
            <span className="discount-tag">−{alert.discount} %</span>
          </div>
          <div className="confidence-row">
            <span className={`confidence ${confidenceClass(alert.confidence)}`}>
              <i /> {alert.confidence}
            </span>
            <span className="score">Achat {alert.buyNow?.score ?? alert.score}/100</span>
            <span className={`access-badge ${alert.priceAccessibleToAll === false ? "is-conditional" : ""}`}>
              {alert.priceAccessibleToAll === false ? "Sous condition" : "Prix public"}
            </span>
          </div>
        </div>
      </button>
      <button
        type="button"
        className={`watch-button ${watched ? "is-watched" : ""}`}
        onClick={onWatch}
        aria-label={watched ? "Retirer des suivis" : "Ajouter aux suivis"}
        aria-pressed={watched}
      >
        {watched ? "◆" : "◇"}
      </button>
    </article>
  );
}

function WatchlistView({
  alerts,
  loading,
  onOpen,
  onRemove,
  onExplore,
}: {
  alerts: AlertItem[];
  loading: boolean;
  onOpen: (alert: AlertItem) => void;
  onRemove: (alert: AlertItem) => void;
  onExplore: () => void;
}) {
  return (
    <section className="view-section">
      <PageHeading
        eyebrow="Votre sélection"
        title="Produits suivis"
        description="Retrouvez ici les signaux que vous souhaitez surveiller dans la durée."
      />
      {loading ? (
        <div className="loading-panel" role="status">
          <span className="loading-orbit" /> Chargement de vos suivis…
        </div>
      ) : alerts.length ? (
        <div className="watch-list">
          {alerts.map((alert) => (
            <div className="watch-row" key={alert.id}>
              <button type="button" onClick={() => onOpen(alert)}>
                <span className={`mini-tile accent-${alert.accent}`}>
                  {alert.label.slice(0, 2)}
                </span>
                <span>
                  <small>{alert.merchant}</small>
                  <strong>{alert.title}</strong>
                  <em>
                    {money(alert.currentPrice, alert.currency)} · −{alert.discount} %
                  </em>
                </span>
              </button>
              <button
                type="button"
                className="remove-watch"
                onClick={() => onRemove(alert)}
                aria-label={`Ne plus suivre ${alert.title}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state spacious">
          <div className="empty-radar" aria-hidden="true" />
          <h2>Votre liste est encore vide</h2>
          <p>
            Ajoutez un signal au suivi pour le retrouver ici et préparer ses
            futures alertes.
          </p>
          <button type="button" className="primary-button" onClick={onExplore}>
            Explorer le radar
          </button>
        </div>
      )}
      <div className="trust-note">
        <span aria-hidden="true">✓</span>
        <div>
          <strong>Une baisse ne suffit pas à déclencher une alerte.</strong>
          <p>
            Prix total, variante, vendeur, stock et fraîcheur devront tous être
            revérifiés par le moteur connecté.
          </p>
        </div>
      </div>
    </section>
  );
}

function SourcesView({
  lookupOpen,
  setLookupOpen,
  asin,
  setAsin,
  market,
  setMarket,
  loading,
  result,
  error,
  onSubmit,
  statuses,
  health,
  liveAlertCount,
}: {
  lookupOpen: boolean;
  setLookupOpen: (value: boolean) => void;
  asin: string;
  setAsin: (value: string) => void;
  market: string;
  setMarket: (value: string) => void;
  loading: boolean;
  result: Record<string, unknown> | null;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  statuses: SourceRuntimeStatus[];
  health: HealthCapabilities | null;
  liveAlertCount: number;
}) {
  const normalized = result
    ? (result.data as Record<string, unknown> | undefined) ?? result
    : null;
  const product = normalized?.product as Record<string, unknown> | undefined;
  const prices = product?.prices as Record<string, unknown> | undefined;
  const productMarket = product?.market as Record<string, unknown> | undefined;
  const title = String(product?.title ?? normalized?.title ?? "Produit Amazon");
  const priceMinor = Number(
    prices?.currentMinor ??
      normalized?.currentPriceMinor ??
      (normalized?.price as Record<string, unknown> | undefined)?.currentMinor ??
      0,
  );
  const currency = String(
    productMarket?.currency ??
      (normalized?.marketplace as Record<string, unknown> | undefined)?.currency ??
      normalized?.currency ??
      (market === "GB" ? "GBP" : "EUR"),
  ) as "EUR" | "GBP";

  function runtimeFor(...sources: string[]) {
    return statuses.find((item) => sources.includes(item.source.toLowerCase()));
  }

  function presentation(
    runtime: SourceRuntimeStatus | undefined,
    fallbackStatus: string,
    fallbackTone: "pending" | "prepared",
  ) {
    const effectiveStatus = runtime?.effectiveStatus?.toLowerCase();
    const reportedStatus = (runtime?.reportedStatus ?? runtime?.status)?.toLowerCase();
    if (runtime?.mode === "live" && effectiveStatus === "healthy") {
      return { status: "Actif", tone: "live" as const };
    }
    if (
      runtime &&
      (effectiveStatus === "degraded" ||
        effectiveStatus === "error" ||
        effectiveStatus === "stale" ||
        effectiveStatus === "offline" ||
        reportedStatus === "degraded" ||
        reportedStatus === "error" ||
        reportedStatus === "offline")
    ) {
      return { status: "À surveiller", tone: "pending" as const };
    }
    return { status: fallbackStatus, tone: fallbackTone };
  }

  const keepaState = presentation(runtimeFor("keepa", "amazon"), "À connecter", "pending");
  const boulangerState = presentation(runtimeFor("boulanger"), "Prêt à déployer", "prepared");
  const dartyState = presentation(runtimeFor("darty"), "Prêt à déployer", "prepared");
  const cdiscountState = presentation(runtimeFor("cdiscount"), "Prêt à déployer", "prepared");
  const apifyActive = statuses.some((item) => item.mode === "live" && Boolean(item.lastSuccessAt));
  const readiness = [
    ["Base Cloudflare", health?.database === true, "D1 et API"],
    ["Keepa", health?.keepa === true, "clé serveur"],
    ["Collecteur", health?.ingestion === true, "secret d’ingestion"],
    ["Identité PWA", health?.deviceIdentity === true, "appareils signés"],
    ["Notifications", health?.pushDeliveryCredentials === true, "Web Push complet"],
    ["Apify", apifyActive, "premier passage"],
  ] as const;

  return (
    <section className="view-section">
      <PageHeading
        eyebrow="État des connecteurs"
        title="Sources & couverture"
        description={
          liveAlertCount
            ? `${liveAlertCount} anomalie${liveAlertCount > 1 ? "s" : ""} active${liveAlertCount > 1 ? "s" : ""}, avec l’état réel de chaque connecteur.`
            : "Une vue honnête de ce qui est prêt, à connecter ou hors couverture."
        }
        action={
          <button
            type="button"
            className="primary-button"
            onClick={() => setLookupOpen(!lookupOpen)}
          >
            {lookupOpen ? "Fermer le test" : "Tester Keepa"}
          </button>
        }
      />

      <div className="readiness-panel" aria-label="Préparation production">
        <div className="readiness-heading">
          <span className="eyebrow">Préparation production</span>
          <h2>{readiness.filter((item) => item[1]).length}/6 blocs raccordés</h2>
          <p>Les éléments payants restent inactifs tant que leurs secrets ne sont pas ajoutés.</p>
        </div>
        <div className="readiness-grid">
          {readiness.map(([label, ready, detail]) => (
            <div key={label} className={ready ? "is-ready" : "is-waiting"}>
              <span aria-hidden="true">{ready ? "✓" : "·"}</span>
              <p><strong>{label}</strong><small>{ready ? "Configuré" : detail}</small></p>
            </div>
          ))}
        </div>
      </div>

      {lookupOpen ? (
        <div className="lookup-panel">
          <div className="lookup-heading">
            <div className="source-logo keepa-logo">K</div>
            <div>
              <span className="eyebrow">Connexion serveur sécurisée</span>
              <h2>Vérifier un ASIN avec Keepa</h2>
              <p>La clé API ne quitte jamais le serveur.</p>
            </div>
          </div>
          <form className="lookup-form" onSubmit={onSubmit}>
            <label>
              <span>Marketplace</span>
              <select value={market} onChange={(e) => setMarket(e.target.value)}>
                {MARKET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="asin-field">
              <span>ASIN</span>
              <input
                value={asin}
                onChange={(e) => setAsin(e.target.value.toUpperCase())}
                placeholder="B0B9C4DKKG"
                maxLength={10}
                autoCapitalize="characters"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="dark-button" disabled={loading}>
              {loading ? "Analyse…" : "Analyser"}
            </button>
          </form>
          {error ? (
            <div className="lookup-message is-error" role="alert">
              <strong>Connexion requise</strong>
              <p>{error}</p>
              <code>KEEPA_API_KEY</code>
            </div>
          ) : null}
          {normalized ? (
            <div className="lookup-result" role="status">
              <span className="result-check">✓</span>
              <div>
                <small>Produit trouvé</small>
                <strong>{title}</strong>
                <span>
                  {priceMinor > 0
                    ? money(priceMinor / 100, currency)
                    : "Prix actuel indisponible"}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="coverage-callout">
        <div>
          <span className="eyebrow">Amazon Europe</span>
          <h2>5 marchés couverts par Keepa</h2>
          <p>
            France, Allemagne, Italie, Espagne et Royaume-Uni. Chaque marché
            conserve son catalogue, sa devise et son historique propres.
          </p>
        </div>
        <div className="market-badges" aria-label="Marchés Amazon couverts">
          {MARKET_OPTIONS.map((option) => (
            <span key={option.value}>{option.value}</span>
          ))}
        </div>
      </div>

      <div className="source-list">
        <SourceRow
          mark="K"
          name="Amazon via Keepa"
          detail="FR · DE · IT · ES · UK"
          status={keepaState.status}
          tone={keepaState.tone}
          runtime={runtimeFor("keepa", "amazon")}
          method="Historique 90 jours, Buy Box, deuxième vérification avant alerte"
        />
        <SourceRow
          mark="B"
          name="Boulanger"
          detail="France · flux catalogue + contrôle page"
          status={boulangerState.status}
          tone={boulangerState.tone}
          runtime={runtimeFor("boulanger")}
          method="Flux partenaire prioritaire, navigateur uniquement en repli"
        />
        <SourceRow
          mark="D"
          name="Darty"
          detail="France · flux affilié + contrôle page"
          status={dartyState.status}
          tone={dartyState.tone}
          runtime={runtimeFor("darty")}
          method="Référence exacte, vendeur et frais de livraison normalisés"
        />
        <SourceRow
          mark="C"
          name="Cdiscount"
          detail="France · marketplace"
          status={cdiscountState.status}
          tone={cdiscountState.tone}
          runtime={runtimeFor("cdiscount")}
          method="Vendeurs tiers séparés, score de fiabilité renforcé"
        />
        <SourceRow
          mark="◎"
          name="Indice PrixRadar"
          detail="Médiane interne · rapprochement multi-enseignes"
          status="Automatique"
          tone="live"
          method="Compare uniquement les variantes suffisamment identiques et les prix accessibles à tous"
        />
        <SourceRow
          mark="S"
          name="Sentinelle autonome"
          detail="Découverte · priorité · fréquence adaptative"
          status="Automatique"
          tone="live"
          method="Découvre les fiches, évite les doublons et rescane plus vite les zones rentables"
        />
      </div>

      <div className="coverage-limit">
        <span aria-hidden="true">!</span>
        <div>
          <strong>Keepa ne couvre pas tous les Amazon européens.</strong>
          <p>
            Belgique, Pays-Bas, Pologne, Suède et Irlande nécessiteront un autre
            fournisseur ou un connecteur dédié. Ils ne sont pas artificiellement
            rattachés à un autre pays.
          </p>
        </div>
      </div>

      <section className="method-section">
        <span className="eyebrow">Méthode d’alerte</span>
        <h2>Du signal à la notification</h2>
        <div className="method-grid">
          {[
            ["01", "Détecter", "Flux, API et pages font remonter les baisses inhabituelles."],
            ["02", "Comparer", "Médiane, historique et références exactes réduisent le bruit."],
            ["03", "Revérifier", "Prix total, stock, variante et vendeur sont relus une seconde fois."],
            ["04", "Alerter", "Seuls les signaux frais et suffisamment fiables sont envoyés."],
          ].map(([number, name, description]) => (
            <div key={number} className="method-card">
              <span>{number}</span>
              <h3>{name}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function SourceRow({
  mark,
  name,
  detail,
  status,
  tone,
  method,
  runtime,
}: {
  mark: string;
  name: string;
  detail: string;
  status: string;
  tone: "pending" | "prepared" | "live";
  method: string;
  runtime?: SourceRuntimeStatus;
}) {
  return (
    <article className="source-row">
      <div className={`source-logo source-${mark.toLowerCase()}`}>{mark}</div>
      <div className="source-identity">
        <h3>{name}</h3>
        <p>{detail}</p>
        {runtime?.lastSuccessAt ? (
          <small>
            Dernier passage {relativeTime(runtime.lastSuccessAt)}
            {runtime.productsSeen ? ` · ${runtime.productsSeen} produits` : ""}
          </small>
        ) : null}
      </div>
      <p className="source-method">{method}</p>
      <span className={`source-status status-${tone}`}>
        <i /> {status}
      </span>
    </article>
  );
}

function SettingsView({
  notificationState,
  onNotifications,
  minScore,
  setMinScore,
  quietHours,
  setQuietHours,
  minDiscount,
  setMinDiscount,
  maxPriceEuros,
  setMaxPriceEuros,
  preferredMarkets,
  setPreferredMarkets,
  preferredCategories,
  setPreferredCategories,
  deliveryCountry,
  setDeliveryCountry,
  postalCode,
  setPostalCode,
  deliveryMode,
  setDeliveryMode,
  requireLocationMatch,
  setRequireLocationMatch,
  analyticsConsent,
  setAnalyticsConsent,
  affiliateConsent,
  setAffiliateConsent,
  notificationSpeed,
  setNotificationSpeed,
  onInstall,
  installReady,
}: {
  notificationState: string;
  onNotifications: () => void;
  minScore: number;
  setMinScore: (value: number) => void;
  quietHours: boolean;
  setQuietHours: (value: boolean) => void;
  minDiscount: number;
  setMinDiscount: (value: number) => void;
  maxPriceEuros: string;
  setMaxPriceEuros: (value: string) => void;
  preferredMarkets: string;
  setPreferredMarkets: (value: string) => void;
  preferredCategories: string;
  setPreferredCategories: (value: string) => void;
  deliveryCountry: string;
  setDeliveryCountry: (value: string) => void;
  postalCode: string;
  setPostalCode: (value: string) => void;
  deliveryMode: "home" | "pickup" | "either";
  setDeliveryMode: (value: "home" | "pickup" | "either") => void;
  requireLocationMatch: boolean;
  setRequireLocationMatch: (value: boolean) => void;
  analyticsConsent: boolean;
  setAnalyticsConsent: (value: boolean) => void;
  affiliateConsent: boolean;
  setAffiliateConsent: (value: boolean) => void;
  notificationSpeed: "instant" | "balanced" | "digest";
  setNotificationSpeed: (value: "instant" | "balanced" | "digest") => void;
  onInstall: () => void;
  installReady: boolean;
}) {
  return (
    <section className="view-section settings-view">
      <PageHeading
        eyebrow="Préférences"
        title="Des alertes utiles, jamais bruyantes"
        description="Ajustez le niveau de confiance et les moments où PrixRadar peut vous prévenir."
      />

      <div className="settings-grid">
        <section className="setting-card setting-featured">
          <div className="setting-icon">↗</div>
          <div className="setting-copy">
            <span className="eyebrow">Application installable</span>
            <h2>Gardez le radar à portée de pouce</h2>
            <p>
              Ajoutez PrixRadar à l’écran d’accueil pour une expérience plein
              écran et un accès plus rapide.
            </p>
          </div>
          <button type="button" className="primary-button" onClick={onInstall}>
            {installReady ? "Installer l’application" : "Voir comment installer"}
          </button>
        </section>

        <section className="setting-card location-preferences">
          <div className="setting-row-heading"><div><span className="eyebrow">Prix livré chez vous</span><h2>Zone et mode de livraison</h2></div><span className="setting-status">Facultatif</span></div>
          <div className="preference-fields">
            <label>Pays<select value={deliveryCountry} onChange={(event) => { setDeliveryCountry(event.target.value); setPostalCode(""); }}><option value="FR">France</option><option value="DE">Allemagne</option><option value="IT">Italie</option><option value="ES">Espagne</option><option value="GB">Royaume-Uni</option></select></label>
            <label>Code postal<input value={postalCode} onChange={(event) => setPostalCode(event.target.value.toUpperCase())} inputMode={deliveryCountry === "GB" ? "text" : "numeric"} autoComplete="postal-code" maxLength={10} placeholder={deliveryCountry === "GB" ? "SW1A 1AA" : "75011"} /></label>
            <label>Livraison<select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "home" | "pickup" | "either")}><option value="either">Domicile ou retrait</option><option value="home">Domicile</option><option value="pickup">Retrait magasin</option></select></label>
          </div>
          <div className="toggle-row compact-toggle"><div><strong>Exiger une vérification locale</strong><p>Si activé, aucune notification n’est envoyée tant que le prix et la livraison n’ont pas été confirmés pour cette zone.</p></div><button type="button" className={`switch ${requireLocationMatch ? "is-on" : ""}`} role="switch" aria-checked={requireLocationMatch} onClick={() => setRequireLocationMatch(!requireLocationMatch)} aria-label="Exiger une vérification locale"><span /></button></div>
          <p>Le collecteur ne reçoit que le contexte nécessaire à la vérification. L’alerte publique n’affiche jamais votre code postal complet.</p>
        </section>

        <section className="setting-card">
          <div className="setting-row-heading">
            <div>
              <span className="eyebrow">Notifications</span>
              <h2>Alertes navigateur</h2>
            </div>
            <span className="setting-status">{notificationState}</span>
          </div>
          <p>
            Activez l’autorisation locale. L’envoi automatique commencera lorsque
            le moteur de collecte sera connecté.
          </p>
          <button type="button" className="secondary-button" onClick={onNotifications}>
            Autoriser et tester
          </button>
          <div className="notification-speed" role="group" aria-label="Vitesse des notifications">
            {([
              ["instant", "Instantané", "Toutes les alertes correspondantes"],
              ["balanced", "Équilibré", "Urgentes puis personnelles"],
              ["digest", "Résumé", "Urgentes + synthèse à 18 h"],
            ] as const).map(([value, label, detail]) => <button key={value} type="button" className={notificationSpeed === value ? "is-active" : ""} onClick={() => setNotificationSpeed(value)}><strong>{label}</strong><small>{detail}</small></button>)}
          </div>
        </section>

        <section className="setting-card personalized-alerts">
          <div className="setting-row-heading"><div><span className="eyebrow">Sans watchlist obligatoire</span><h2>Filtres d’alertes personnalisés</h2></div></div>
          <div className="preference-fields">
            <label>Remise minimale <strong>{minDiscount} %</strong><input type="range" min="0" max="90" step="5" value={minDiscount} onChange={(event) => setMinDiscount(Number(event.target.value))} /></label>
            <label>Budget maximal (€)<input type="number" min="1" inputMode="decimal" value={maxPriceEuros} onChange={(event) => setMaxPriceEuros(event.target.value)} placeholder="Sans limite" /></label>
            <label>Pays Amazon<input value={preferredMarkets} onChange={(event) => setPreferredMarkets(event.target.value)} placeholder="FR, DE, IT, ES, GB" /></label>
            <label>Catégories<input value={preferredCategories} onChange={(event) => setPreferredCategories(event.target.value)} placeholder="Audio, Gaming, Maison" /></label>
          </div>
          <p>Ces règles s’appliquent directement aux notifications push, même sans produit suivi.</p>
        </section>

        <section className="setting-card">
          <div className="setting-row-heading">
            <div>
              <span className="eyebrow">Seuil de confiance</span>
              <h2>{minScore}/100 minimum</h2>
            </div>
            <span className={`confidence ${confidenceClass(minScore >= 85 ? "Très probable" : "Probable")}`}>
              <i /> {minScore >= 85 ? "Très sélectif" : "Équilibré"}
            </span>
          </div>
          <input
            className="score-range"
            type="range"
            min="60"
            max="95"
            step="5"
            value={minScore}
            onChange={(event) => setMinScore(Number(event.target.value))}
            aria-label="Score minimal de confiance"
          />
          <div className="range-labels">
            <span>Plus de signaux</span>
            <span>Plus fiable</span>
          </div>
        </section>

        <section className="setting-card">
          <div className="toggle-row">
            <div>
              <span className="eyebrow">Tranquillité</span>
              <h2>Silence de 22 h à 8 h</h2>
              <p>Aucune alerte n’est envoyée pendant cette plage, même si le signal expire.</p>
            </div>
            <button
              type="button"
              className={`switch ${quietHours ? "is-on" : ""}`}
              role="switch"
              aria-checked={quietHours}
              onClick={() => setQuietHours(!quietHours)}
              aria-label="Activer les heures silencieuses"
            >
              <span />
            </button>
          </div>
        </section>
      </div>

      <div className="privacy-card">
        <span className="privacy-mark">P</span>
        <div>
          <strong>Vos suivis restent liés à cet appareil.</strong>
          <p>
            La liste est enregistrée côté serveur avec un identifiant anonyme.
            Aucune clé Keepa ni donnée sensible n’est stockée dans le navigateur.
          </p>
          <div className="consent-actions">
            <label><input type="checkbox" checked={analyticsConsent} onChange={(event) => setAnalyticsConsent(event.target.checked)} /> Mesure d’usage optionnelle</label>
            <label><input type="checkbox" checked={affiliateConsent} onChange={(event) => setAffiliateConsent(event.target.checked)} /> Liens affiliés facultatifs</label>
          </div>
        </div>
      </div>
    </section>
  );
}

function AlertDetail({
  alert,
  watched,
  onWatch,
  onFeedback,
  useAffiliateLink,
  onClose,
}: {
  alert: AlertItem;
  watched: boolean;
  onWatch: () => void;
  onFeedback: (verdict: "useful" | "false_positive" | "expired" | "purchased" | "cancelled" | "wrong_variant" | "coupon_failed" | "price_confirmed") => void;
  useAffiliateLink: boolean;
  onClose: () => void;
}) {
  const buyNow = alert.buyNow ?? { score: alert.score, label: "À considérer", factors: [], cautions: [] };
  const community = alert.community ?? { total: 0, positive: 0, negative: 0, expired: 0, purchased: 0 };
  const [recheck, setRecheck] = useState<"idle" | "pending" | "processing" | "completed" | "failed">("idle");
  const [recheckMessage, setRecheckMessage] = useState("");

  async function verifyNow() {
    if (alert.sourceMode !== "live") return setRecheckMessage("La vérification immédiate est réservée aux alertes actives.");
    setRecheck("pending");
    setRecheckMessage("Contrôle ajouté à la file prioritaire…");
    try {
      const response = await fetch("/api/recheck", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alertId: alert.id }) });
      if (!response.ok) throw new Error("La file de vérification est indisponible.");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 3_000));
        const statusResponse = await fetch(`/api/recheck?alertId=${encodeURIComponent(alert.id)}`, { headers: { accept: "application/json" } });
        const payload = await statusResponse.json() as { items?: Array<{ status?: string; result?: Record<string, unknown> }> };
        const item = payload.items?.[0];
        if (item?.status === "completed") {
          setRecheck("completed");
          const checkedAt = typeof item.result?.verifiedAt === "string" ? relativeTime(item.result.verifiedAt) : "à l’instant";
          setRecheckMessage(`Prix, stock, vendeur et livraison revérifiés ${checkedAt}.`);
          return;
        }
        if (item?.status === "failed") throw new Error("La page marchande n’a pas pu être relue.");
        setRecheck("processing");
        setRecheckMessage("Le collecteur relit la page et compare la variante…");
      }
      setRecheckMessage("Contrôle toujours en file : vous pouvez fermer cet écran, le résultat sera conservé.");
    } catch (error) {
      setRecheck("failed");
      setRecheckMessage(error instanceof Error ? error.message : "Vérification impossible.");
    }
  }

  return (
    <div className="detail-backdrop" onMouseDown={onClose}>
      <aside
        className="detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <header className="detail-header">
          <div>
            <span className="merchant-pill">{alert.merchant}</span>
            <span className={`demo-inline ${alert.sourceMode === "live" ? "is-live" : ""}`}>
              {alert.sourceMode === "live" ? "DONNÉE ACTIVE" : "EXEMPLE"}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer l’analyse">
            ×
          </button>
        </header>

        <div className={`detail-hero accent-${alert.accent}`}>
          <span>{alert.label}</span>
          <i />
        </div>
        <div className="detail-title-block">
          <p>{alert.category} · {alert.sku}</p>
          <h2 id="detail-title">{alert.title}</h2>
          <div className="detail-price">
            <strong>{money(alert.currentPrice, alert.currency)}</strong>
            <del>{money(alert.usualPrice, alert.currency)}</del>
            <span>−{alert.discount} %</span>
          </div>
        </div>

        <section className="confidence-box">
          <div className="score-ring" style={{ "--score": `${alert.score * 3.6}deg` } as React.CSSProperties}>
            <span>{alert.score}</span>
          </div>
          <div>
            <span className={`confidence ${confidenceClass(alert.confidence)}`}>
              <i /> {alert.confidence}
            </span>
            <h3>Pourquoi ce score ?</h3>
            <p>
              Plus les références, l’historique et la seconde lecture concordent,
              plus le signal est fiable.
            </p>
          </div>
        </section>

        <section className={`buy-now-box buy-now-${buyNow.score >= 80 ? "go" : buyNow.score >= 60 ? "consider" : "wait"}`}>
          <div><span className="eyebrow">Décision d’achat</span><h3>{buyNow.label}</h3><p>Un score séparé de la simple remise : historique, marché, vendeur, stock, livraison et accessibilité.</p></div><strong>{buyNow.score}<small>/100</small></strong>
          {buyNow.factors.length > 0 ? <div className="buy-now-factors">{buyNow.factors.map((factor, index) => <span key={factor.key ?? index}><i style={{ width: `${Math.min(100, Math.round((Number(factor.points ?? 0) / Math.max(1, Number(factor.maximum ?? 1))) * 100))}%` }} /><small>{factor.label ?? factor.key}</small></span>)}</div> : null}
          {buyNow.cautions.length > 0 ? <p className="buy-now-cautions">{buyNow.cautions.join(" · ")}</p> : null}
        </section>

        {alert.intelligence ? (
          <section className="detail-section autonomy-passport">
            <div className="section-label-row"><h3>Contrôle autonome</h3><span>{anomalyLabel(alert.intelligence.anomaly.kind)}</span></div>
            <div className="autonomy-grid">
              <div><span>Panier fantôme</span><strong>{cartLabel(alert.intelligence.shadowCart.status)}</strong><small>{alert.intelligence.shadowCart.finalTotalCents ? `${money(alert.intelligence.shadowCart.finalTotalCents / 100, alert.currency)} final` : "total à confirmer"}</small></div>
              <div><span>Variante exacte</span><strong>{alert.intelligence.variant.confidence}/100</strong><small>{alert.intelligence.variant.comparable ? "comparable" : "prudence"}</small></div>
              <div><span>Indice PrixRadar</span><strong>{alert.intelligence.priceIndex.medianCents ? money(alert.intelligence.priceIndex.medianCents / 100, alert.currency) : "En cours"}</strong><small>{alert.intelligence.priceIndex.merchantCount ?? 0} offres rapprochées</small></div>
              <div><span>Vendeur & garantie</span><strong>{alert.intelligence.seller.score}/100</strong><small>{alert.intelligence.seller.level ?? "analysé"}</small></div>
              <div><span>Durée probable</span><strong>{alert.intelligence.lifetime.predictedLifetimeMinutes ? `≈ ${alert.intelligence.lifetime.predictedLifetimeMinutes} min` : "Inconnue"}</strong><small>urgence {alert.intelligence.lifetime.urgencyScore}/100</small></div>
              <div><span>Origine détectée</span><strong>{anomalyLabel(alert.intelligence.anomaly.kind)}</strong><small>preuves {alert.intelligence.anomaly.evidenceStrength ?? 0}/100</small></div>
            </div>
          </section>
        ) : null}

        <section className="detail-section">
          <div className="section-label-row">
            <h3>Les indices</h3>
            <span>3 contrôles</span>
          </div>
          <ul className="reason-list">
            {alert.reasons.map((reason) => (
              <li key={reason}>
                <span aria-hidden="true">✓</span> {reason}
              </li>
            ))}
          </ul>
        </section>

        {alert.history.length > 0 ? (
          <section className="detail-section">
            <div className="section-label-row">
              <h3>Historique 90 jours</h3>
              <span>{alert.source.includes("Keepa") ? "Keepa" : "Interne"}</span>
            </div>
            <div className="price-chart" aria-label="Historique de prix simplifié">
              {alert.history.map((value, index) => (
                <i key={`${value}-${index}`} style={{ height: `${value}%` }} />
              ))}
            </div>
            <div className="chart-legend">
              <span>Il y a 90 jours</span>
              <span>Maintenant</span>
            </div>
          </section>
        ) : (
          <section className="detail-section">
            <div className="section-label-row">
              <h3>Historique non disponible</h3>
              <span>Signal actuel</span>
            </div>
            <p>
              Aucune série de prix vérifiée n’a été transmise pour cette alerte.
              Aucun graphique historique n’est donc affiché.
            </p>
          </section>
        )}

        <section className="detail-section verified-grid">
          <div><span>Vendeur</span><strong>{alert.seller}</strong></div>
          <div><span>État</span><strong>{alert.condition}</strong></div>
          <div><span>Livraison</span><strong>{alert.shipping}</strong></div>
          <div><span>Zone</span><strong>{alert.locationVerified ? alert.locationLabel : "Non vérifiée localement"}</strong></div>
          <div><span>Dernier contrôle</span><strong>{alert.verifiedAt}</strong></div>
        </section>

        <section className="detail-section proof-passport">
          <div className="section-label-row"><h3>Passeport de preuve</h3><span>{alert.sourceMode === "live" ? "Traçable" : "Exemple"}</span></div>
          <dl><div><dt>Identité exacte</dt><dd>{alert.gtin ? `EAN ${alert.gtin}` : `${alert.brand ?? "Marque non transmise"} · ${alert.model ?? alert.sku}`}</dd></div><div><dt>Observation</dt><dd>{alert.observedAt ? new Date(alert.observedAt).toLocaleString("fr-FR") : alert.freshness}</dd></div><div><dt>Double contrôle</dt><dd>{alert.verifiedAt} · prix, variante, vendeur</dd></div><div><dt>Validité</dt><dd>{alert.expiresAt ? `jusqu’au ${new Date(alert.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "à revérifier"}</dd></div><div><dt>Comparaison</dt><dd>{alert.marketSources ? `${alert.marketSources} enseignes comparables` : "historique interne ou Keepa"}</dd></div></dl>
          <button type="button" className="dark-button verify-now" onClick={() => void verifyNow()} disabled={recheck === "pending" || recheck === "processing"}>{recheck === "pending" || recheck === "processing" ? "Vérification en cours…" : recheck === "completed" ? "Revérifier à nouveau" : "Vérifier maintenant"}</button>
          {recheckMessage ? <p className={`recheck-status is-${recheck}`} role="status">{recheckMessage}</p> : null}
        </section>

        <section className="detail-section">
          <div className="section-label-row"><h3>Accessibilité du prix</h3><span>{alert.priceAccessibleToAll === false ? "Conditionnel" : "Pour tous"}</span></div>
          <p>{alert.priceAccessibleToAll === false ? alert.promotionLabel ?? "Ce montant exige une condition commerciale à vérifier." : "Ce prix ne dépend ni d’une carte, ni d’un coupon, ni d’une reprise détectée."}</p>
          {alert.marketMedian && alert.marketSources ? <p><strong>Comparaison marché :</strong> médiane de {money(alert.marketMedian, alert.currency)} sur {alert.marketSources} autres enseignes.</p> : null}
        </section>

        <section className="detail-section feedback-box">
          <div className="section-label-row"><h3>Verdict de la communauté</h3><span>{community.total ? `${community.positive}/${community.total} positifs` : "Premier avis"}</span></div>
          <p>{community.purchased > 0 ? `${community.purchased} achat${community.purchased > 1 ? "s" : ""} confirmé${community.purchased > 1 ? "s" : ""}. ` : ""}Un appareil ne peut voter qu’une fois par alerte.</p>
          <div className="feedback-actions feedback-expanded"><button onClick={() => onFeedback("purchased")}>Acheté</button><button onClick={() => onFeedback("price_confirmed")}>Prix confirmé</button><button onClick={() => onFeedback("useful")}>Bonne alerte</button><button onClick={() => onFeedback("expired")}>Expiré</button><button onClick={() => onFeedback("wrong_variant")}>Mauvaise variante</button><button onClick={() => onFeedback("coupon_failed")}>Coupon impossible</button><button onClick={() => onFeedback("cancelled")}>Commande annulée</button><button onClick={() => onFeedback("false_positive")}>Faux positif</button></div>
        </section>

        <div className="detail-warning">
          <span aria-hidden="true">!</span>
          <p>
            Un prix peut expirer ou être annulé. Vérifiez le total et le vendeur
            sur la page finale avant de payer.
          </p>
        </div>

        <footer className="detail-actions">
          <button
            type="button"
            className={`secondary-button detail-watch ${watched ? "is-watched" : ""}`}
            onClick={onWatch}
          >
            {watched ? "◆ Suivi" : "◇ Suivre"}
          </button>
          <a
            className="primary-button"
            href={useAffiliateLink && alert.affiliateUrl ? alert.affiliateUrl : alert.url}
            target="_blank"
            rel="noreferrer"
          >
            Vérifier chez {alert.merchant} ↗
          </a>
          <button type="button" className="secondary-button" onClick={() => {
            const proofUrl = `${window.location.origin}/?alert=${encodeURIComponent(alert.id)}`;
            const text = `${alert.title} · ${money(alert.currentPrice, alert.currency)} · score achat ${buyNow.score}/100 · vérifié à ${alert.verifiedAt}`;
            if (navigator.share) void navigator.share({ title: "Preuve PrixRadar", text, url: proofUrl });
            else void navigator.clipboard?.writeText(`${text} · ${proofUrl}`);
          }}>Partager la preuve</button>
        </footer>
      </aside>
    </div>
  );
}

let zxingLoader: Promise<void> | null = null;
function loadZxingFallback() {
  if ((window as unknown as { ZXingBrowser?: unknown }).ZXingBrowser) return Promise.resolve();
  if (zxingLoader) return zxingLoader;
  zxingLoader = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/@zxing/browser@0.2.1/umd/zxing-browser.min.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("ZXing indisponible"));
    document.head.appendChild(script);
  });
  return zxingLoader;
}

function BarcodeScanner({ onClose, onDetected }: { onClose: () => void; onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [manual, setManual] = useState("");
  const [status, setStatus] = useState("Ouverture de la caméra arrière…");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let fallbackControls: { stop: () => void } | null = null;
    let frame = 0;
    let stopped = false;
    type Detector = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> };
    type DetectorConstructor = new (options: { formats: string[] }) => Detector;
    const DetectorClass = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia) {
      window.setTimeout(() => setStatus("La caméra n’est pas disponible dans ce navigateur. Saisissez l’EAN indiqué sous le code-barres."), 0);
      return;
    }
    if (!DetectorClass) {
      type ZXingResult = { getText?: () => string };
      type ZXingReader = { decodeFromConstraints: (constraints: MediaStreamConstraints, element: HTMLVideoElement, callback: (result?: ZXingResult) => void) => Promise<{ stop: () => void }> };
      type ZXingGlobal = { BrowserMultiFormatReader: new () => ZXingReader };
      void loadZxingFallback().then(async () => {
        if (stopped || !videoRef.current) return;
        const library = (window as unknown as { ZXingBrowser?: ZXingGlobal }).ZXingBrowser;
        if (!library) throw new Error("ZXing absent");
        const reader = new library.BrowserMultiFormatReader();
        fallbackControls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          videoRef.current,
          (result) => {
            const code = result?.getText?.() ?? "";
            if (/^\d{8,14}$/u.test(code)) {
              stopped = true;
              fallbackControls?.stop();
              onDetected(code);
            }
          },
        );
        setStatus("Placez le code-barres dans le cadre · moteur ZXing iPhone");
      }).catch(() => setStatus("Le moteur de scan n’a pas pu être chargé. Saisissez l’EAN manuellement."));
      return () => {
        stopped = true;
        fallbackControls?.stop();
      };
    }
    const detector = new DetectorClass({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
    const scan = async () => {
      if (stopped || !videoRef.current) return;
      try {
        const results = await detector.detect(videoRef.current);
        const code = results.find((result) => /^\d{8,14}$/u.test(result.rawValue ?? ""))?.rawValue;
        if (code) {
          stopped = true;
          onDetected(code);
          return;
        }
      } catch { /* la vidéo n’est peut-être pas encore prête */ }
      frame = window.requestAnimationFrame(() => void scan());
    };
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((value) => {
        if (stopped) return value.getTracks().forEach((track) => track.stop());
        stream = value;
        if (videoRef.current) {
          videoRef.current.srcObject = value;
          void videoRef.current.play().then(() => {
            setStatus("Placez le code-barres dans le cadre");
            void scan();
          });
        }
      }).catch(() => setStatus("Caméra refusée. Vous pouvez saisir l’EAN manuellement."));
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetected]);

  return <div className="scanner-backdrop" onMouseDown={onClose}><section className="scanner-panel" role="dialog" aria-modal="true" aria-labelledby="scanner-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow">Recherche instantanée</span><h2 id="scanner-title">Scanner un EAN</h2></div><button onClick={onClose} aria-label="Fermer">×</button></header><div className="camera-frame"><video ref={videoRef} playsInline muted /><span aria-hidden="true" /></div><p role="status">{status}</p><form onSubmit={(event) => { event.preventDefault(); const code = manual.replace(/\D/gu, ""); if (/^\d{8,14}$/u.test(code)) onDetected(code); else setStatus("Un EAN contient 8 à 14 chiffres."); }}><label>Ou saisir le numéro<input value={manual} onChange={(event) => setManual(event.target.value)} inputMode="numeric" autoComplete="off" placeholder="3701234567890" maxLength={18} /></label><button className="primary-button">Rechercher</button></form></section></div>;
}
