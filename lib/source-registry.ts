export type ActiveSourceId = "amazon" | "boulanger" | "cdiscount" | "darty";
export type PlannedSourceId = "fnac" | "carrefour" | "e_leclerc" | "rueducommerce";
export type KnownSourceId = ActiveSourceId | PlannedSourceId;

export type SourceRegistryEntry = {
  id: KnownSourceId;
  displayName: string;
  status: "active" | "planned";
  markets: readonly string[];
  hosts: readonly string[];
  defaultCadenceMinutes: number;
  verification: readonly ("http" | "browser" | "cart" | "api")[];
  adapterVersion: string;
};

export const SOURCE_REGISTRY_VERSION = "2026.07.1";

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
  { id: "fnac", displayName: "Fnac", status: "planned", markets: ["FR"], hosts: ["fnac.com"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: "0.0.0" },
  { id: "carrefour", displayName: "Carrefour", status: "planned", markets: ["FR"], hosts: ["carrefour.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: "0.0.0" },
  { id: "e_leclerc", displayName: "E.Leclerc", status: "planned", markets: ["FR"], hosts: ["e.leclerc"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: "0.0.0" },
  { id: "rueducommerce", displayName: "Rue du Commerce", status: "planned", markets: ["FR"], hosts: ["rueducommerce.fr"], defaultCadenceMinutes: 60, verification: ["http", "browser", "cart"], adapterVersion: "0.0.0" },
] as const;

export const ACTIVE_SOURCE_REGISTRY = SOURCE_REGISTRY
  .filter((source): source is SourceRegistryEntry & { id: ActiveSourceId; status: "active" } => source.status === "active");

export const ACTIVE_SOURCE_IDS = ACTIVE_SOURCE_REGISTRY.map((source) => source.id);

const activeSources = new Set<string>(ACTIVE_SOURCE_IDS);

export function isActiveSource(value: string): value is ActiveSourceId {
  return activeSources.has(value);
}

export function sourceDefinition(value: string) {
  return SOURCE_REGISTRY.find((source) => source.id === value) ?? null;
}

export function sourceForHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./u, "").replace(/\.$/u, "");
  return ACTIVE_SOURCE_REGISTRY.find((source) => source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) ?? null;
}
