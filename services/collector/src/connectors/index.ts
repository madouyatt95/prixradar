import * as cheerio from "cheerio";

import { extractJsonLdOffers } from "./jsonld.js";
import {
  cleanText,
  normalizeProductUrl,
  parseMoneyMinor,
  productKey,
} from "../normalize.js";
import type {
  Availability,
  Currency,
  Market,
  OfferSnapshot,
  RetailSource,
  VariantIdentityEvidence,
} from "../types.js";

export interface ShadowCartAdapter {
  addButton: readonly string[];
  confirmation: readonly string[];
  cartScope: readonly string[];
  itemPrice: readonly string[];
  shipping: readonly string[];
  total: readonly string[];
  cartPathPatterns: readonly RegExp[];
}

export interface RetailConnector {
  connectorId: string;
  version: string;
  source: RetailSource;
  market: Market;
  currency: Currency;
  allowedHosts: ReadonlySet<string>;
  productPathPatterns: readonly RegExp[];
  selectors: {
    title: readonly string[];
    price: readonly string[];
    referencePrice: readonly string[];
    externalId: readonly string[];
    shipping: readonly string[];
    seller: readonly string[];
    availability: readonly string[];
    condition: readonly string[];
  };
  variantOptions: Readonly<Record<string, readonly string[]>>;
  shadowCart: ShadowCartAdapter;
  pagination: {
    nextSelectors: readonly string[];
    pageParameters: readonly string[];
    maxPage: number;
  };
}

const BOULANGER: RetailConnector = {
  connectorId: "boulanger-fr",
  version: "2026.07.1",
  source: "boulanger",
  market: "FR",
  currency: "EUR",
  allowedHosts: new Set(["boulanger.com", "www.boulanger.com"]),
  productPathPatterns: [/^\/ref\/[A-Za-z0-9_-]+\/?$/u],
  selectors: {
    title: ["h1", "[itemprop='name']", "meta[property='og:title']"],
    price: ["[itemprop='price']", "meta[property='product:price:amount']", "[data-testid*='price']"],
    referencePrice: ["[data-testid*='old-price']", ".old-price", ".price--crossed"],
    externalId: ["[itemprop='sku']", "[data-product-id]", "[data-product-code]", "[data-ref]"],
    shipping: ["[itemprop='shippingDetails']", "[data-testid*='delivery']", "[data-testid*='shipping']"],
    seller: ["[itemprop='seller']", "[data-testid*='seller']"],
    availability: ["[itemprop='availability']", "[data-testid*='availability']", "button[data-testid*='cart']"],
    condition: ["[itemprop='itemCondition']", "[data-testid*='condition']"],
  },
  variantOptions: {
    color: ["[data-testid='selected-color']", "[data-testid*='color'] [aria-checked='true']", "[data-qa='selected-color']"],
    capacity: ["[data-testid='selected-capacity']", "[data-testid*='capacity'] [aria-checked='true']", "[data-qa='selected-capacity']"],
    size: ["[data-testid='selected-size']", "[data-testid*='size'] [aria-checked='true']"],
  },
  shadowCart: {
    addButton: ["button[data-testid='add-to-cart']", "button[data-testid='add-to-cart-button']", "button[data-qa='add-to-cart']", "button[name='addToCart']"],
    confirmation: ["[data-testid='add-to-cart-modal']", "[data-testid='cart-drawer']", ".add-to-cart-modal", "[role='dialog'][aria-label*='panier' i]"],
    cartScope: ["[data-testid='add-to-cart-modal']", "[data-testid='cart-drawer']", "[data-testid='basket']", ".cart-drawer"],
    itemPrice: ["[data-testid='cart-item-price']", "[data-testid='basket-item-price']", ".cart-item-price"],
    shipping: ["[data-testid='shipping-price']", "[data-testid='delivery-price']", ".shipping-price"],
    total: ["[data-testid='cart-total']", "[data-testid='basket-total']", ".cart-total"],
    cartPathPatterns: [/^\/panier(?:[/?]|$)/iu, /^\/basket(?:[/?]|$)/iu],
  },
  pagination: {
    nextSelectors: ["link[rel='next']", "a[rel='next']", "[data-testid='pagination-next'] a", "a[aria-label*='suivante' i]"],
    pageParameters: ["page", "p", "pagenumber"],
    maxPage: 20,
  },
};

const DARTY: RetailConnector = {
  connectorId: "darty-fr",
  version: "2026.07.1",
  source: "darty",
  market: "FR",
  currency: "EUR",
  allowedHosts: new Set(["darty.com", "www.darty.com"]),
  productPathPatterns: [/^\/nav\/achat\/.+\.html$/u],
  selectors: {
    title: ["h1", "[itemprop='name']", "meta[property='og:title']"],
    price: ["[itemprop='price']", "meta[property='product:price:amount']", "[data-testid*='price']"],
    referencePrice: [".darty_prix_barre", ".old_price", "[data-testid*='old-price']"],
    externalId: ["[itemprop='sku']", "[data-product-id]", "[data-sku]", "meta[property='product:retailer_item_id']"],
    shipping: ["[itemprop='shippingDetails']", "[class*='delivery']", "[data-testid*='shipping']"],
    seller: ["[itemprop='seller']", "[class*='seller']"],
    availability: ["[itemprop='availability']", "[class*='availability']", "button[class*='cart']"],
    condition: ["[itemprop='itemCondition']", "[class*='condition']"],
  },
  variantOptions: {
    color: ["[data-testid='selected-color']", "[data-automation-id='selected-color']", "[class*='color'] [aria-checked='true']"],
    capacity: ["[data-testid='selected-capacity']", "[data-automation-id='selected-capacity']", "[class*='capacity'] [aria-checked='true']"],
    size: ["[data-testid='selected-size']", "[data-automation-id='selected-size']"],
  },
  shadowCart: {
    addButton: ["button[data-testid='add-to-cart']", "button[data-automation-id='add-to-cart']", "button.darty_add_to_cart", "button[name='addToCart']"],
    confirmation: ["[data-testid='basket-modal']", "[data-testid='cart-drawer']", ".darty-modal_basket", "[role='dialog'][aria-label*='panier' i]"],
    cartScope: ["[data-testid='basket-modal']", "[data-testid='cart-drawer']", "[data-automation-id='basket']", ".darty-modal_basket"],
    itemPrice: ["[data-testid='basket-item-price']", "[data-automation-id='basket-item-price']", ".basket-item-price"],
    shipping: ["[data-testid='delivery-price']", "[data-automation-id='delivery-price']", ".delivery-price"],
    total: ["[data-testid='basket-total']", "[data-automation-id='basket-total']", ".basket-total"],
    cartPathPatterns: [/^\/panier(?:[/?]|$)/iu, /^\/basket(?:[/?]|$)/iu],
  },
  pagination: {
    nextSelectors: ["link[rel='next']", "a[rel='next']", "a.pagination__next", "a[aria-label*='suivante' i]"],
    pageParameters: ["page", "p", "pagenumber"],
    maxPage: 20,
  },
};

const CDISCOUNT: RetailConnector = {
  connectorId: "cdiscount-fr",
  version: "2026.07.1",
  source: "cdiscount",
  market: "FR",
  currency: "EUR",
  allowedHosts: new Set(["cdiscount.com", "www.cdiscount.com"]),
  productPathPatterns: [/^\/.+\/f-\d+[a-z0-9-]*\.html$/iu],
  selectors: {
    title: ["h1", "[itemprop='name']", "meta[property='og:title']"],
    price: ["[itemprop='price']", "meta[property='product:price:amount']", "[data-testid*='price']"],
    referencePrice: [".fpStriked", ".oldPrice", "[data-testid*='old-price']"],
    externalId: ["input[name='ProductId']", "[itemprop='sku']", "[data-product-id]", "[data-sku]"],
    shipping: ["[itemprop='shippingDetails']", "[class*='delivery']", "[class*='shipping']"],
    seller: ["[itemprop='seller']", "[class*='seller']", "[class*='merchant']"],
    availability: ["[itemprop='availability']", "[class*='availability']", "button[class*='cart']"],
    condition: ["[itemprop='itemCondition']", "[class*='condition']"],
  },
  variantOptions: {
    color: ["[data-testid='selected-color']", "[data-sku-selector='color'] [aria-selected='true']", "[class*='color'] [aria-checked='true']"],
    capacity: ["[data-testid='selected-capacity']", "[data-sku-selector='capacity'] [aria-selected='true']", "[class*='capacity'] [aria-checked='true']"],
    size: ["[data-testid='selected-size']", "[data-sku-selector='size'] [aria-selected='true']"],
  },
  shadowCart: {
    addButton: ["button#fpAdd2Basket", "button[data-testid='add-to-cart']", "button.js-add-to-cart", "button[name='addToCart']"],
    confirmation: ["#bValidationPanier", "#cartModal", "[data-testid='cart-modal']", ".add-to-cart-modal"],
    cartScope: ["#bValidationPanier", "#cartModal", "[data-testid='cart-modal']", "[data-testid='basket']"],
    itemPrice: ["[data-testid='cart-item-price']", ".basket-item-price", ".product-price"],
    shipping: ["[data-testid='shipping-price']", ".shipping-price", ".delivery-price"],
    total: ["[data-testid='cart-total']", ".basket-total", ".total-price"],
    cartPathPatterns: [/^\/(?:basket|panier)(?:[/?]|$)/iu],
  },
  pagination: {
    nextSelectors: ["link[rel='next']", "a[rel='next']", "a.pgNext", "a[aria-label*='suivante' i]"],
    pageParameters: ["page", "p", "pagenumber"],
    maxPage: 20,
  },
};

function amazonConnector(
  market: Market,
  currency: Currency,
  hosts: readonly string[],
): RetailConnector {
  return {
    connectorId: `amazon-${market.toLowerCase()}`,
    version: "2026.07.1",
    source: "amazon",
    market,
    currency,
    allowedHosts: new Set(hosts),
    productPathPatterns: [/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/iu],
    selectors: {
      title: ["#productTitle", "h1", "meta[property='og:title']"],
      price: ["#corePrice_feature_div .a-offscreen", ".priceToPay .a-offscreen", "#priceblock_ourprice", "#priceblock_dealprice"],
      referencePrice: [".basisPrice .a-offscreen", ".a-price.a-text-price .a-offscreen", "#listPrice"],
      externalId: ["input#ASIN", "input[name='ASIN']", "#dp-container[data-asin]", "body[data-asin]", "#averageCustomerReviews[data-asin]"],
      shipping: ["#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE", "#deliveryBlockMessage", "[data-csa-c-delivery-price]"],
      seller: ["#sellerProfileTriggerId", "#merchant-info", "#tabular-buybox-truncate-1"],
      availability: ["#availability", "#add-to-cart-button", "#buy-now-button"],
      condition: ["#newAccordionRow", ".offer-display-condition", "[itemprop='itemCondition']"],
    },
    variantOptions: {
      color: ["#variation_color_name .selection", "[data-csa-c-content-id='variation_color_name'] .selection"],
      size: ["#variation_size_name .selection", "[data-csa-c-content-id='variation_size_name'] .selection"],
      capacity: ["#variation_size_name .selection", "#variation_style_name .selection", "[data-csa-c-content-id='variation_size_name'] .selection"],
      style: ["#variation_style_name .selection", "#variation_pattern_name .selection"],
    },
    shadowCart: {
      addButton: ["#add-to-cart-button", "input[name='submit.add-to-cart']", "#addToCart input[name='submit.add-to-cart']"],
      confirmation: ["#attachDisplayAddBaseAlert", "#NATC_SMART_WAGON_CONF_MSG_SUCCESS", "#huc-v2-order-row-confirm-text", "#sw-atc-confirmation"],
      cartScope: ["#attach-accessory-pane", "#sw-atc-confirmation", "#sw-subtotal", "#nav-cart"],
      itemPrice: ["#attach-accessory-cart-subtotal .a-price .a-offscreen", "#sw-subtotal .a-price .a-offscreen", "#sc-subtotal-amount-activecart .a-offscreen"],
      shipping: ["#sc-shipping-cost .a-offscreen", "[data-csa-c-delivery-price]"],
      total: ["#attach-accessory-cart-subtotal .a-price .a-offscreen", "#sw-subtotal .a-price .a-offscreen", "#sc-subtotal-amount-activecart .a-offscreen"],
      cartPathPatterns: [/^\/gp\/cart(?:[/?]|$)/iu, /^\/cart(?:[/?]|$)/iu],
    },
    pagination: {
      nextSelectors: ["link[rel='next']", "a[rel='next']", "a.s-pagination-next", "a[aria-label*='next' i]", "a[aria-label*='suivante' i]"],
      pageParameters: ["page"],
      maxPage: 20,
    },
  };
}

const AMAZON_CONNECTORS = [
  amazonConnector("FR", "EUR", ["amazon.fr", "www.amazon.fr"]),
  amazonConnector("DE", "EUR", ["amazon.de", "www.amazon.de"]),
  amazonConnector("IT", "EUR", ["amazon.it", "www.amazon.it"]),
  amazonConnector("ES", "EUR", ["amazon.es", "www.amazon.es"]),
  amazonConnector("GB", "GBP", ["amazon.co.uk", "www.amazon.co.uk"]),
] as const;

export const RETAIL_CONNECTORS = [BOULANGER, DARTY, CDISCOUNT, ...AMAZON_CONNECTORS] as const;
export const CONNECTOR_REGISTRY_VERSION = "2026.07.1";

export function connectorRegistrySnapshot(): Array<{
  connectorId: string;
  version: string;
  source: RetailSource;
  market: Market;
}> {
  return RETAIL_CONNECTORS.map(({ connectorId, version, source, market }) => ({ connectorId, version, source, market }));
}

export function connectorForUrl(rawUrl: string): RetailConnector {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL source invalide.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Seules les URL HTTPS sans identifiants sont acceptées.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/u, "");
  const connector = RETAIL_CONNECTORS.find((candidate) => candidate.allowedHosts.has(host));
  if (!connector) throw new Error("Hôte marchand non autorisé.");
  return connector;
}

function selectorValue($: cheerio.CheerioAPI, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    const element = $(selector).first();
    if (element.length === 0) continue;
    const value = element.attr("content")
      ?? element.attr("value")
      ?? element.attr("data-product-id")
      ?? element.attr("data-product-code")
      ?? element.attr("data-sku")
      ?? element.attr("data-ref")
      ?? element.attr("data-asin")
      ?? element.attr("href")
      ?? element.text();
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizedVariantPart(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, "");
  if (!normalized || normalized.length > 140 || /[^a-z0-9._:/-]/u.test(normalized)) return null;
  return normalized;
}

function canonicalPathIdentity(rawUrl: string, connector: RetailConnector): string | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (url.protocol !== "https:" || !connector.allowedHosts.has(host) || url.username || url.password) return null;
    const path = decodeURIComponent(url.pathname).replace(/\/{2,}/gu, "/").replace(/\/$/u, "").toLowerCase();
    return path ? `path:${path}` : null;
  } catch {
    return null;
  }
}

/** Identity expected from the requested URL only; never from rendered markup. */
export function expectedVariantIdForUrl(rawUrl: string, connector = connectorForUrl(rawUrl)): string | null {
  const url = new URL(rawUrl);
  if (connector.source === "amazon") {
    const asin = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/iu.exec(url.pathname)?.[1];
    return asin ? `asin:${asin.toLowerCase()}` : null;
  }
  if (connector.source === "boulanger") {
    const reference = /^\/ref\/([A-Za-z0-9_-]+)\/?$/u.exec(url.pathname)?.[1] ?? null;
    const normalized = normalizedVariantPart(reference);
    return normalized ? `sku:${normalized}` : null;
  }
  for (const key of ["productId", "productid", "sku", "ref"]) {
    const raw = url.searchParams.get(key);
    const normalized = normalizedVariantPart(raw);
    if (normalized) return `sku:${normalized}`;
  }
  // Darty and Cdiscount do not consistently expose the SKU in their public URL.
  // Their canonical product path is therefore the independent requested identity.
  return canonicalPathIdentity(rawUrl, connector);
}

function observedVariantIdentity(
  $: cheerio.CheerioAPI,
  connector: RetailConnector,
  requestedUrl: string,
  jsonLdExternalId: string | null,
): VariantIdentityEvidence {
  const expectedId = expectedVariantIdForUrl(requestedUrl, connector);
  const domMerchantId = selectorValue($, connector.selectors.externalId);
  const merchantProductId = normalizedVariantPart(domMerchantId ?? jsonLdExternalId);
  let observedId: string | null = null;
  let observedSource: VariantIdentityEvidence["observedSource"] = "unknown";

  if (expectedId?.startsWith("asin:")) {
    const asin = merchantProductId?.match(/(?:^|:)([a-z0-9]{10})$/u)?.[1] ?? null;
    observedId = asin ? `asin:${asin}` : null;
    observedSource = observedId ? (domMerchantId ? "merchant_dom" : "json_ld") : "unknown";
  } else if (expectedId?.startsWith("sku:")) {
    observedId = merchantProductId ? `sku:${merchantProductId}` : null;
    observedSource = observedId ? (domMerchantId ? "merchant_dom" : "json_ld") : "unknown";
  } else if (expectedId?.startsWith("path:")) {
    const renderedCanonical = selectorValue($, ["link[rel='canonical']", "meta[property='og:url']"]);
    observedId = renderedCanonical ? canonicalPathIdentity(new URL(renderedCanonical, requestedUrl).toString(), connector) : null;
    observedSource = observedId ? "canonical_link" : "unknown";
  }

  const selectedOptions: Record<string, string> = {};
  for (const [name, selectors] of Object.entries(connector.variantOptions)) {
    const value = selectorValue($, selectors);
    if (value) selectedOptions[name] = value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase().slice(0, 120);
  }
  const gtin = selectorValue($, [
    "[itemprop='gtin14']",
    "[itemprop='gtin13']",
    "[itemprop='gtin12']",
    "[itemprop='gtin8']",
    "meta[property='product:ean']",
    "[data-ean]",
  ])?.replace(/\D/gu, "") ?? null;

  return {
    expectedId,
    observedId,
    expectedSource: expectedId ? "request_url" : "unknown",
    observedSource,
    merchantProductId,
    gtin: gtin && gtin.length >= 8 && gtin.length <= 14 ? gtin : null,
    selectedOptions,
  };
}

function promotionFromPage($: cheerio.CheerioAPI): NonNullable<OfferSnapshot["promotion"]> {
  const text = selectorValue($, [
    "#couponText",
    "[data-testid*='coupon']",
    "[class*='coupon']",
    "[class*='loyalty']",
    "[class*='fidelite']",
    "[class*='prime']",
    "[class*='cashback']",
    "[class*='odr']",
    "[class*='reprise']",
    "[class*='trade-in']",
    "[class*='bundle']",
    "[class*='pack']",
  ]);
  if (text === null) return { type: "public_price", label: null, accessibleToAll: true };
  const normalized = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const type = /(?:lot|pack|bundle).*(?:avec|comprend|inclut)|achetes?.*(?:offert|ensemble)/u.test(normalized)
    ? "bundle"
    : /reprise|trade[- ]?in/u.test(normalized)
    ? "trade_in"
    : /rembours|cashback|\bodr\b/u.test(normalized)
      ? "cashback"
      : /prime|membre|fidelite|carte/u.test(normalized)
        ? "membership"
        : /coupon|code promo|appliquer/u.test(normalized)
          ? "coupon"
          : "unknown";
  return { type, label: cleanText(text, 240), accessibleToAll: false };
}

function shippingMinor(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\b(gratuit(?:e)?|gratuit[ao]|gratis|kostenlos|free delivery|free shipping)\b/u.test(normalized)) return 0;
  return parseMoneyMinor(value);
}

function availability(value: string | null): Availability {
  if (value === null) return "unknown";
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (/indisponible|rupture|out of stock|nicht verfugbar|non disponibile|no disponible/u.test(normalized)) return "out_of_stock";
  if (/precommande|pre-order|vorbestell|preordine|preventa/u.test(normalized)) return "preorder";
  if (/en stock|in stock|auf lager|disponibile|disponibilita|disponible|add-to-cart|buy-now/u.test(normalized)) return "in_stock";
  return "unknown";
}

function condition(value: string | null): OfferSnapshot["condition"] {
  if (value === null) return "unknown";
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (/recondition|refurbished|erneuert|ricondizionat|reacondicionad/u.test(normalized)) return "refurbished";
  if (/occasion|used|gebraucht|usato|usado/u.test(normalized)) return "used";
  if (/neuf|new|neu|nuovo|nuevo/u.test(normalized)) return "new";
  return "unknown";
}

function trustedSeller(source: RetailSource, value: string | null): boolean {
  if (value === null) return false;
  const normalized = value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  const direct: Record<RetailSource, readonly string[]> = {
    boulanger: ["boulanger", "boulangercom"],
    darty: ["darty", "dartycom"],
    cdiscount: ["cdiscount", "cdiscountcom"],
    amazon: ["amazon", "amazonfr", "amazonde", "amazonit", "amazones", "amazoncouk"],
  };
  if (direct[source].includes(normalized)) return true;
  if (source !== "amazon") return false;
  return /(?:vendu(?: et expedie)? par|sold(?: and dispatched)? by|verkauf(?: und versand)? durch|venduto(?: e spedito)? da|vendido(?: y enviado)? por)\s*amazon\b/iu.test(value);
}

function sellerSignalsFromPage($: cheerio.CheerioAPI, seller: string | null, trusted: boolean): NonNullable<OfferSnapshot["sellerSignals"]> {
  const signalText = selectorValue($, [
    "#seller-feedback-summary",
    "[data-testid*='seller-rating']",
    "[class*='sellerRating']",
    "[class*='seller-rating']",
    "[class*='merchant-rating']",
  ]) ?? "";
  const normalized = signalText.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const percentMatch = /(\d{1,3})\s*%/u.exec(normalized);
  const starsMatch = /(\d(?:[.,]\d)?)\s*(?:\/\s*5|sur\s*5|out of 5)/u.exec(normalized);
  const rawRating = percentMatch ? Number(percentMatch[1]!) : starsMatch ? Number(starsMatch[1]!.replace(",", ".")) * 20 : null;
  const countMatch = /([\d\s.,]{1,16})\s*(?:avis|evaluations?|ratings?|reviews?)/u.exec(normalized);
  const reviewCount = countMatch ? Number.parseInt(countMatch[1]!.replace(/\D/gu, ""), 10) : null;
  const pageText = cleanText($("body").text(), 20_000)?.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase() ?? "";
  const platformFulfilled = /expedie par amazon|fulfilled by amazon|versand durch amazon|expedido por amazon|expedie par cdiscount/u.test(pageText);
  return {
    ratingPercent: rawRating === null ? null : Math.max(0, Math.min(100, Math.round(rawRating))),
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
    fulfillment: trusted ? "direct" : platformFulfilled ? "platform" : seller ? "merchant" : "unknown",
    country: null,
    warranty: /garantie\s*(?:legale|2\s*ans)|warranty|garanzia|garantia|gewahrleistung/u.test(pageText) ? true : null,
    returns: /retours?\s*(?:gratuit|sous|dans)|free returns?|ruckgabe|reso gratuito|devolucion/u.test(pageText) ? true : null,
  };
}

function cartProbeFromPage(
  $: cheerio.CheerioAPI,
  offer: Pick<OfferSnapshot, "price" | "shipping" | "total" | "availability" | "promotion">,
  connector: RetailConnector,
): NonNullable<OfferSnapshot["cartProbe"]> {
  const addToCartAvailable = connector.shadowCart.addButton.some((selector) => $(selector).length > 0);
  return {
    status: offer.availability === "out_of_stock" ? "unavailable" : "product_page",
    itemCents: offer.price.amountMinor,
    shippingCents: offer.shipping?.amountMinor ?? null,
    totalCents: offer.total?.amountMinor ?? null,
    stockConfirmed: offer.availability === "in_stock",
    addToCartAvailable,
    identityConfirmed: false,
    explicitShipping: false,
    explicitTotal: false,
    couponApplied: offer.promotion?.type === "coupon" ? false : true,
    checkedAt: null,
  };
}

function fallbackOffer(
  html: string,
  pageUrl: string,
  connector: RetailConnector,
  options: { observedAt?: string; fixture?: boolean; requestedUrl?: string },
): OfferSnapshot | null {
  const $ = cheerio.load(html);
  const title = selectorValue($, connector.selectors.title);
  const priceMinor = parseMoneyMinor(selectorValue($, connector.selectors.price));
  if (!title || priceMinor === null || priceMinor <= 0) return null;

  const url = normalizeProductUrl(pageUrl, connector.allowedHosts);
  const externalId = selectorValue($, connector.selectors.externalId)
    ?? url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/iu)?.[1]?.toUpperCase()
    ?? url.match(/(?:\/ref\/|\/f-)([A-Za-z0-9_-]+)/u)?.[1]
    ?? url;
  const referenceMinor = parseMoneyMinor(selectorValue($, connector.selectors.referencePrice));
  const shippingAmount = shippingMinor(selectorValue($, connector.selectors.shipping));
  const seller = selectorValue($, connector.selectors.seller);
  const offerAvailability = availability(selectorValue($, connector.selectors.availability));
  const offerCondition = condition(selectorValue($, connector.selectors.condition));

  const sellerTrusted = trustedSeller(connector.source, seller);
  const variantIdentity = observedVariantIdentity($, connector, options.requestedUrl ?? pageUrl, externalId);
  const offer: OfferSnapshot = {
    product: {
      productKey: productKey({ source: connector.source, market: connector.market, externalId }),
      source: connector.source,
      market: connector.market,
      externalId,
      title,
      brand: null,
      model: null,
      gtin: null,
      category: selectorValue($, ["meta[property='product:category']", "[itemprop='category']"]),
      url,
      imageUrl: cleanText($("meta[property='og:image']").attr("content"), 2_048),
    },
    variantIdentity,
    price: { amountMinor: priceMinor, currency: connector.currency },
    shipping: shippingAmount === null ? null : { amountMinor: shippingAmount, currency: connector.currency },
    total: shippingAmount === null ? null : { amountMinor: priceMinor + shippingAmount, currency: connector.currency },
    referencePrice: referenceMinor !== null && referenceMinor > priceMinor
      ? { amountMinor: referenceMinor, currency: connector.currency }
      : null,
    seller,
    sellerTrusted,
    condition: offerCondition,
    availability: offerAvailability,
    observedAt: options.observedAt ?? new Date().toISOString(),
    strategy: "connector",
    fixture: options.fixture ?? false,
    promotion: promotionFromPage($),
  };
  offer.cartProbe = cartProbeFromPage($, offer, connector);
  offer.sellerSignals = sellerSignalsFromPage($, seller, sellerTrusted);
  return offer;
}

export function extractRetailOffers(
  html: string,
  pageUrl: string,
  options: { observedAt?: string; fixture?: boolean; requestedUrl?: string } = {},
): OfferSnapshot[] {
  const connector = connectorForUrl(pageUrl);
  const structured = extractJsonLdOffers(html, {
    source: connector.source,
    market: connector.market,
    currency: connector.currency,
    pageUrl,
    allowedHosts: connector.allowedHosts,
    ...options,
  });
  if (structured.length > 0) {
    const $ = cheerio.load(html);
    const promotion = promotionFromPage($);
    const category = selectorValue($, ["meta[property='product:category']", "[itemprop='category']"]);
    return structured.map((offer) => {
      const variantIdentity = observedVariantIdentity(
        $,
        connector,
        options.requestedUrl ?? pageUrl,
        offer.product.externalId,
      );
      const enriched: OfferSnapshot = {
        ...offer,
        product: { ...offer.product, category },
        variantIdentity,
        promotion,
      };
      enriched.cartProbe = cartProbeFromPage($, enriched, connector);
      enriched.sellerSignals = sellerSignalsFromPage($, enriched.seller, enriched.sellerTrusted);
      return enriched;
    });
  }
  const fallback = fallbackOffer(html, pageUrl, connector, options);
  return fallback ? [fallback] : [];
}

export function discoverProductUrls(html: string, pageUrl: string, limit = 100): string[] {
  const connector = connectorForUrl(pageUrl);
  const $ = cheerio.load(html);
  const unique = new Set<string>();

  for (const link of $("a[href]").toArray()) {
    const href = $(link).attr("href");
    if (!href) continue;
    try {
      const candidate = normalizeProductUrl(new URL(href, pageUrl).toString(), connector.allowedHosts);
      const path = new URL(candidate).pathname;
      if (!connector.productPathPatterns.some((pattern) => pattern.test(path))) continue;
      unique.add(candidate);
      if (unique.size >= limit) break;
    } catch {
      // External, malformed and non-HTTPS links are ignored.
    }
  }
  return [...unique];
}

function numericPage(url: URL, parameters: readonly string[]): number | null {
  const allowed = new Set(parameters.map((parameter) => parameter.toLowerCase()));
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key.toLowerCase()) || !/^\d{1,3}$/u.test(value)) continue;
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Returns one same-merchant next page only. The candidate must expose a known
 * page parameter, advance by exactly one and remain under the connector cap.
 */
export function discoverNextPageUrl(html: string, pageUrl: string): string | null {
  const connector = connectorForUrl(pageUrl);
  const $ = cheerio.load(html);
  const current = new URL(pageUrl);
  const currentPage = numericPage(current, connector.pagination.pageParameters) ?? 1;
  if (currentPage >= connector.pagination.maxPage) return null;

  for (const selector of connector.pagination.nextSelectors) {
    const href = $(selector).first().attr("href");
    if (!href) continue;
    try {
      const candidate = new URL(href, pageUrl);
      const candidateConnector = connectorForUrl(candidate.toString());
      if (candidateConnector.connectorId !== connector.connectorId) continue;
      if (candidate.pathname === current.pathname && candidate.search === current.search) continue;
      if (connector.productPathPatterns.some((pattern) => pattern.test(candidate.pathname))) continue;
      const candidatePage = numericPage(candidate, connector.pagination.pageParameters);
      if (candidatePage !== currentPage + 1 || candidatePage > connector.pagination.maxPage) continue;
      return normalizeProductUrl(candidate.toString(), connector.allowedHosts);
    } catch {
      // Malformed, cross-origin and non-HTTPS pagination candidates are ignored.
    }
  }
  return null;
}
