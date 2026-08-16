export const AMAZON_FOCUS_BRANDS = ["Apple", "Samsung"] as const;

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
