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
  | "carrefour"
  | "castorama"
  | "conforama"
  | "fnac"
  | "leroy_merlin"
  | "rueducommerce";
export type PlannedSourceId = "e_leclerc";
export type KnownSourceId = ActiveSourceId | PlannedSourceId;

export const PARTNER_REQUIRED_SOURCE_IDS = [
  "fnac",
  "carrefour",
  "leroy_merlin",
  "castorama",
  "conforama",
  "rueducommerce",
] as const satisfies readonly PartnerRequiredSourceId[];

export type SourceRegistryEntry = {
  id: KnownSourceId;
  displayName: string;
  status: "active" | "partner_required" | "planned";
  markets: readonly string[];
  hosts: readonly string[];
  defaultCadenceMinutes: number;
  verification: readonly ("http" | "browser" | "cart" | "api")[];
  adapterVersion: string;
};

export const SOURCE_REGISTRY_VERSION = "2026.07.2";

export const SOURCE_REGISTRY: readonly SourceRegistryEntry[] = [
  {
    id: "amazon",
    displayName: "Amazon Europe",
    status: "active",
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
    markets: ["FR"],
    hosts: ["cdiscount.com"],
    defaultCadenceMinutes: 30,
    verification: ["http", "browser", "cart"],
    adapterVersion: SOURCE_REGISTRY_VERSION,
  },
  { id: "fnac", displayName: "Fnac", status: "partner_required", markets: ["FR"], hosts: ["fnac.com"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "carrefour", displayName: "Carrefour", status: "partner_required", markets: ["FR"], hosts: ["carrefour.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "leroy_merlin", displayName: "Leroy Merlin", status: "partner_required", markets: ["FR"], hosts: ["leroymerlin.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "castorama", displayName: "Castorama", status: "partner_required", markets: ["FR"], hosts: ["castorama.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "conforama", displayName: "Conforama", status: "partner_required", markets: ["FR"], hosts: ["conforama.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
  { id: "e_leclerc", displayName: "E.Leclerc", status: "planned", markets: ["FR"], hosts: ["e.leclerc"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: "0.0.0" },
  { id: "rueducommerce", displayName: "Rue du Commerce", status: "partner_required", markets: ["FR"], hosts: ["rueducommerce.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: SOURCE_REGISTRY_VERSION },
] as const;

export const ACTIVE_SOURCE_REGISTRY = SOURCE_REGISTRY
  .filter((source): source is SourceRegistryEntry & { id: ActiveSourceId; status: "active" | "partner_required" } => source.status !== "planned");

export const ACTIVE_SOURCE_IDS = ACTIVE_SOURCE_REGISTRY.map((source) => source.id);

const activeSources = new Set<string>(ACTIVE_SOURCE_IDS);
const partnerRequiredSources = new Set<string>(PARTNER_REQUIRED_SOURCE_IDS);

export function isActiveSource(value: string): value is ActiveSourceId {
  return activeSources.has(value);
}

export function isPartnerRequiredSource(value: string): value is PartnerRequiredSourceId {
  return partnerRequiredSources.has(value);
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
