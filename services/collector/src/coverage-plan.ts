import { connectorForUrl } from "./connectors/index.js";

export interface CoverageTarget {
  url: string;
  sourceConfigurationId: string;
  productLimit: number | null;
}

export function parseCoverageTargets(value: unknown): CoverageTarget[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): CoverageTarget[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    if (item.discoveryStrategy !== "links" || typeof item.discoveryUrl !== "string" || typeof item.id !== "string") return [];
    if (!/^[A-Za-z0-9._:-]{3,160}$/.test(item.id)) return [];
    const url = typeof item.pageCursor === "string" && item.pageCursor ? item.pageCursor : item.discoveryUrl;
    try {
      const seedConnector = connectorForUrl(item.discoveryUrl);
      const cursorConnector = connectorForUrl(url);
      if (seedConnector.source !== cursorConnector.source || seedConnector.market !== cursorConnector.market) return [];
    } catch {
      return [];
    }
    const productLimit = Number.isSafeInteger(item.productLimit)
      ? Math.max(1, Math.min(100, Number(item.productLimit)))
      : null;
    return [{ url, sourceConfigurationId: item.id, productLimit }];
  });
}
