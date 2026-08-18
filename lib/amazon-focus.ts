export const AMAZON_FOCUS_BRANDS = ["Apple", "Samsung"] as const;

// The old Apple/Samsung experiment is kept as an explicit helper for legacy
// user-created radars. Automatic coverage now uses this category vocabulary.
export const AMAZON_FOCUS_CATEGORY_TERMS = [
  "high tech", "informatique", "ordinateur", "pc portable", "laptop",
  "smartphone", "telephone", "iphone", "ipad", "macbook", "tablette",
  "ecran", "moniteur", "ssd", "disque dur", "clavier", "souris",
  "imprimante", "routeur", "wifi", "gaming", "console", "audio",
  "casque", "television", "image et son", "maison", "electromenager",
  "aspirateur", "robot cuiseur", "cuisine", "four", "lave linge",
  "lave vaisselle", "refrigerateur", "chauffage", "climatisation", "meuble",
  "matelas", "literie", "bricolage", "jardin", "eclairage", "luminaire",
  "outillage", "rangement", "nettoyage",
] as const;

function normalizedBrand(value: string | null | undefined) {
  return (value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

export function isAmazonFocusBrand(brand: string | null | undefined) {
  const value = normalizedBrand(brand);
  return AMAZON_FOCUS_BRANDS.some((brandName) => {
    const expected = normalizedBrand(brandName);
    return value === expected || value === `${expected} inc` || value === `${expected} electronics`;
  });
}

export function isAmazonFocusTitle(title: string | null | undefined) {
  const value = normalizedBrand(title);
  return /\b(?:apple|iphone|ipad|macbook|imac|airpods|airtag|homepod|samsung|galaxy|odyssey)\b/u.test(value)
    || /\bmac mini\b/u.test(value)
    || /\bapple watch\b/u.test(value)
    || /\bstudio display\b/u.test(value);
}

export function isAmazonFocusCategory(category: string | null | undefined, title: string | null | undefined) {
  const value = normalizedBrand(`${category ?? ""} ${title ?? ""}`);
  return AMAZON_FOCUS_CATEGORY_TERMS.some((term) => value.includes(term));
}
