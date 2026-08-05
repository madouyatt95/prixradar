export type ActiveSourceId =
  | "amazon"
  | "boulanger"
  | "carrefour"
  | "castorama"
  | "cdiscount"
  | "conforama"
  | "darty"
  | "fnac"
  | "leroy_merlin"
  | "rueducommerce";
export type PartnerRequiredSourceId =
  | "castorama"
  | "conforama"
  | "rueducommerce";
export type PublicWebSourceId = "carrefour" | "fnac" | "leroy_merlin";
export type PlannedSourceId = "e_leclerc";
export type KnownSourceId = ActiveSourceId | PlannedSourceId;

export const PARTNER_REQUIRED_SOURCE_IDS = [
  "castorama",
  "conforama",
  "rueducommerce",
] as const satisfies readonly PartnerRequiredSourceId[];

export const PUBLIC_WEB_SOURCE_IDS = [
  "fnac",
  "carrefour",
  "leroy_merlin",
] as const satisfies readonly PublicWebSourceId[];

export type SourceRegistryEntry = {
  id: KnownSourceId;
  displayName: string;
  status: "active" | "partner_required" | "planned";
  accessMode: "api" | "public_web" | "direct_web" | "authorization_required" | "planned";
  markets: readonly string[];
  hosts: readonly string[];
  defaultCadenceMinutes: number;
  verification: readonly ("http" | "browser" | "cart" | "api")[];
  adapterVersion: string;
};

export const SOURCE_REGISTRY_VERSION = "2026.08.1";

export const SOURCE_REGISTRY: readonly SourceRegistryEntry[] = [
  {
    id: "amazon",
    displayName: "Amazon Europe",
    status: "active",
    accessMode: "api",
    markets: ["FR", "DE", "IT", "ES", "GB"],
    hosts: ["amazon.fr", "amazon.de", "amazon.it", "amazon.es", "amazon.co.uk"],
    defaultCadenceMinutes: 15,
    verification: ["api", "http", "browser", "cart"],
    adapterVersion: SOURCE_REGISTRY_VERSION,
  },
  {
    id: "boulanger",
    displayName: "Boulanger",
    status: "active",
    accessMode: "direct_web",
    markets: ["FR"],
    hosts: ["boulanger.com"],
    defaultCadenceMinutes: 30,
    verification: ["http", "browser", "cart"],
    adapterVersion: SOURCE_REGISTRY_VERSION,
  },
  {
    id: "darty",
    displayName: "Darty",
    status: "active",
    accessMode: "direct_web",
    markets: ["FR"],
    hosts: ["darty.com"],
    defaultCadenceMinutes: 30,
    verification: ["http", "browser", "cart"],
    adapterVersion: SOURCE_REGISTRY_VERSION,
  },
  {
    id: "cdiscount",
    displayName: "Cdiscount",
    status: "active",
    accessMode: "direct_web",
    markets: ["FR"],
    hosts: ["cdiscount.com"],
    defaultCadenceMinutes: 30,
    verification: ["http", "browser", "cart"],
    adapterVersion: SOURCE_REGISTRY_VERSION,
  },
  { id: "fnac", displayName: "Fnac", status: "active", accessMode: "public_web", markets: ["FR"], hosts: ["fnac.com"], defaultCadenceMinutes: 240, verification: ["http", "browser"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "carrefour", displayName: "Carrefour", status: "active", accessMode: "public_web", markets: ["FR"], hosts: ["carrefour.fr"], defaultCadenceMinutes: 240, verification: ["http", "browser"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "leroy_merlin", displayName: "Leroy Merlin", status: "active", accessMode: "public_web", markets: ["FR"], hosts: ["leroymerlin.fr"], defaultCadenceMinutes: 240, verification: ["http", "browser"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "castorama", displayName: "Castorama", status: "partner_required", accessMode: "authorization_required", markets: ["FR"], hosts: ["castorama.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "conforama", displayName: "Conforama", status: "partner_required", accessMode: "authorization_required", markets: ["FR"], hosts: ["conforama.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "e_leclerc", displayName: "E.Leclerc", status: "planned", accessMode: "planned", markets: ["FR"], hosts: ["e.leclerc"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: "0.0.0" },
  { id: "rueducommerce", displayName: "Rue du Commerce", status: "partner_required", accessMode: "authorization_required", markets: ["FR"], hosts: ["rueducommerce.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
] as const;

export const ACTIVE_SOURCE_REGISTRY = SOURCE_REGISTRY
  .filter((source): source is SourceRegistryEntry & { id: ActiveSourceId; status: "active" | "partner_required" } => source.status !== "planned");

export const ACTIVE_SOURCE_IDS = ACTIVE_SOURCE_REGISTRY.map((source) => source.id);

const activeSources = new Set<string>(ACTIVE_SOURCE_IDS);
const partnerRequiredSources = new Set<string>(PARTNER_REQUIRED_SOURCE_IDS);
const publicWebSources = new Set<string>(PUBLIC_WEB_SOURCE_IDS);

export function isActiveSource(value: string): value is ActiveSourceId {
  return activeSources.has(value);
}

export function isPartnerRequiredSource(value: string): value is PartnerRequiredSourceId {
  return partnerRequiredSources.has(value);
}

export function isPublicWebSource(value: string): value is PublicWebSourceId {
  return publicWebSources.has(value);
}

const PRIVATE_OR_TRANSACTION_PATH = /\/(?:account|auth|basket|cart|checkout|commande|compte|connexion|login|order|paiement|payment|panier|wishlist)(?:\/|$)/iu;

export function isApprovedPublicWebUrl(source: string, url: URL): boolean {
  if (!isPublicWebSource(source)) return true;
  if (PRIVATE_OR_TRANSACTION_PATH.test(url.pathname)) return false;
  if (source === "fnac") {
    return /(?:^\/index\/p(?:\/|$)|^\/navigation\/plan\.aspx$|\/a\d+(?:\/|$)|\/(?:s|sh)\d+(?:\/|$)|\/w-\d+(?:\/|$))/iu.test(url.pathname);
  }
  if (source === "carrefour") {
    if (/^\/(?:b|g)(?:\/|$)/iu.test(url.pathname)) return false;
    return /^\/(?:p|r)(?:\/|$)/iu.test(url.pathname) || /^\/edito\/plan-du-site\/?$/iu.test(url.pathname);
  }
  return /^\/produits(?:\/|$)/iu.test(url.pathname) || /^\/plan-de-site-produits\.html$/iu.test(url.pathname);
}

export function authorizedPartnerSources(raw: string | undefined): Set<PartnerRequiredSourceId> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is PartnerRequiredSourceId => isPartnerRequiredSource(value)),
  );
}

export function isPartnerSourceAuthorized(source: string, raw: string | undefined): boolean {
  return !isPartnerRequiredSource(source) || authorizedPartnerSources(raw).has(source);
}

export function sourceDefinition(value: string) {
  return SOURCE_REGISTRY.find((source) => source.id === value) ?? null;
}

export function sourceForHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./u, "").replace(/\.$/u, "");
  return ACTIVE_SOURCE_REGISTRY.find((source) => source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) ?? null;
}
