export type DeliveryMode = "home" | "pickup" | "either";

const COUNTRY_FORMATS: Record<string, RegExp> = {
  FR: /^\d{5}$/u,
  DE: /^\d{5}$/u,
  IT: /^\d{5}$/u,
  ES: /^\d{5}$/u,
  GB: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/u,
};

export function deliveryCountry(value: unknown) {
  if (typeof value !== "string") throw new Error("deliveryCountry doit être un pays pris en charge.");
  const normalized = value.trim().toUpperCase();
  if (!(normalized in COUNTRY_FORMATS)) throw new Error("Pays de livraison non pris en charge.");
  return normalized;
}

export function postalCode(value: unknown, country: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("postalCode est invalide.");
  const normalized = value.trim().toUpperCase().replace(/\s+/gu, " ");
  const format = COUNTRY_FORMATS[country];
  if (!format?.test(normalized)) throw new Error("Code postal invalide pour le pays choisi.");
  return normalized;
}

export function deliveryMode(value: unknown): DeliveryMode {
  if (value !== "home" && value !== "pickup" && value !== "either") {
    throw new Error("deliveryMode doit être home, pickup ou either.");
  }
  return value;
}

export function postalPrefix(value: string | null, country: string) {
  if (!value) return null;
  if (country === "GB") return value.replace(/\s.+$/u, "").slice(0, 4);
  return value.slice(0, 2);
}
