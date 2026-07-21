export type RadarIntent = {
  keywords: string[];
  brands: string[];
  categories: string[];
  markets: string[];
  maxPriceCents: number | null;
  minDiscount: number | null;
  condition: "new" | "used" | "refurbished" | null;
  accessibleToAll: boolean;
  deliveryCountry: string | null;
};

export type RadarCandidate = {
  title: string;
  brand?: string | null;
  category?: string | null;
  market: string;
  priceCents: number;
  discountPercent: number;
  condition?: string | null;
  accessibleToAll: boolean;
  deliveryCountry?: string | null;
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  Audio: ["audio", "casque", "ecouteur", "enceinte", "soundbar"],
  Gaming: ["gaming", "console", "playstation", "xbox", "switch", "jeu video"],
  Informatique: ["informatique", "ordinateur", "pc", "laptop", "ssd", "ecran"],
  Maison: ["maison", "aspirateur", "robot", "nettoyeur"],
  Cuisine: ["cuisine", "airfryer", "friteuse", "cafe", "four"],
  "Image & son": ["television", "tv", "oled", "projecteur"],
  Smartphone: ["smartphone", "telephone", "iphone", "galaxy", "pixel"],
};

const BRANDS = [
  "apple", "samsung", "sony", "lg", "lenovo", "asus", "acer", "dell", "hp",
  "nintendo", "microsoft", "dyson", "dreame", "xiaomi", "google", "bose", "philips",
];

const STOP_WORDS = new Set([
  "alerte", "alerter", "alertez", "cherche", "recherche", "trouve", "trouver", "veux",
  "voudrais", "quand", "avec", "sans", "pour", "dans", "moins", "sous", "maximum",
  "max", "budget", "neuf", "neuve", "occasion", "reconditionne", "reconditionnee", "livre",
  "livraison", "france", "allemagne", "italie", "espagne", "royaume", "uni", "amazon",
  "remise", "reduction", "minimum", "moins", "prix", "public", "coupon", "carte", "de",
  "du", "des", "la", "le", "les", "un", "une", "et", "ou", "a", "au", "aux", "en",
]);

function normalized(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

function distinct(values: string[]) {
  return [...new Set(values)];
}

function moneyLimit(text: string) {
  const match = /(?:sous|moins de|max(?:imum)?|budget(?: de)?)[^\d]{0,12}(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:€|euros?)/iu.exec(text)
    ?? /(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:€|euros?)\s*(?:max(?:imum)?|ou moins)/iu.exec(text);
  if (!match) return null;
  const amount = Number(match[1].replace(",", "."));
  return Number.isFinite(amount) && amount > 0 ? Math.min(100_000_000, Math.round(amount * 100)) : null;
}

export function parseRadarIntent(query: string): RadarIntent {
  const clean = normalized(query).replace(/[’']/gu, " ");
  const markets: string[] = [];
  if (/\b(france|amazon fr|amazon\.fr)\b/u.test(clean)) markets.push("FR");
  if (/\b(allemagne|amazon de|amazon\.de)\b/u.test(clean)) markets.push("DE");
  if (/\b(italie|amazon it|amazon\.it)\b/u.test(clean)) markets.push("IT");
  if (/\b(espagne|amazon es|amazon\.es)\b/u.test(clean)) markets.push("ES");
  if (/\b(royaume uni|uk|amazon co uk|amazon\.co\.uk)\b/u.test(clean)) markets.push("GB");

  const categories = Object.entries(CATEGORY_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => clean.includes(alias)))
    .map(([category]) => category);
  const brands = BRANDS.filter((brand) => new RegExp(`\\b${brand}\\b`, "u").test(clean));
  const discountMatch = /(?:remise|reduction|baisse|moins)[^\d]{0,12}(\d{1,2})\s*%/u.exec(clean)
    ?? /(\d{1,2})\s*%\s*(?:de\s+)?(?:remise|reduction|minimum|mini|ou plus)/u.exec(clean);
  const condition = /\breconditionn/u.test(clean)
    ? "refurbished" as const
    : /\b(occasion|utilise)/u.test(clean)
      ? "used" as const
      : /\bneuf/u.test(clean)
        ? "new" as const
        : null;
  const keywords = distinct(clean
    .replace(/\d+(?:[.,]\d+)?\s*(?:€|euros?|%)/gu, " ")
    .replace(/[^a-z0-9-]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token) && !BRANDS.includes(token))
    .slice(0, 12));

  return {
    keywords,
    brands,
    categories,
    markets: distinct(markets),
    maxPriceCents: moneyLimit(clean),
    minDiscount: discountMatch ? Math.min(90, Number(discountMatch[1])) : null,
    condition,
    accessibleToAll: /\b(sans coupon|sans carte|prix public|accessible a tous|pour tous)\b/u.test(clean),
    deliveryCountry: /\b(livre|livraison)\b.{0,20}\bfrance\b/u.test(clean) ? "FR" : null,
  };
}

export function radarIntentMatches(intent: RadarIntent, candidate: RadarCandidate) {
  const haystack = normalized(`${candidate.title} ${candidate.brand ?? ""} ${candidate.category ?? ""}`);
  if (intent.keywords.length > 0 && !intent.keywords.every((keyword) => haystack.includes(keyword))) return false;
  if (intent.brands.length > 0 && !intent.brands.some((brand) => haystack.includes(brand))) return false;
  if (intent.categories.length > 0 && !intent.categories.includes(candidate.category ?? "")) return false;
  if (intent.markets.length > 0 && !intent.markets.includes(candidate.market)) return false;
  if (intent.maxPriceCents !== null && candidate.priceCents > intent.maxPriceCents) return false;
  if (intent.minDiscount !== null && candidate.discountPercent < intent.minDiscount) return false;
  if (intent.condition !== null && normalized(candidate.condition ?? "") !== intent.condition) return false;
  if (intent.accessibleToAll && !candidate.accessibleToAll) return false;
  if (intent.deliveryCountry !== null && candidate.deliveryCountry !== intent.deliveryCountry) return false;
  return true;
}

export function radarIntentSummary(intent: RadarIntent) {
  const parts: string[] = [];
  if (intent.brands.length) parts.push(intent.brands.join(", "));
  if (intent.keywords.length) parts.push(intent.keywords.join(" "));
  if (intent.categories.length) parts.push(intent.categories.join(", "));
  if (intent.maxPriceCents !== null) parts.push(`≤ ${Math.round(intent.maxPriceCents / 100)} €`);
  if (intent.minDiscount !== null) parts.push(`−${intent.minDiscount} % minimum`);
  if (intent.markets.length) parts.push(intent.markets.join(", "));
  return parts.join(" · ") || "Tous les produits vérifiés";
}
