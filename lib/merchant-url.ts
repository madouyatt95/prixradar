export type SupportedMerchant = "amazon" | "boulanger" | "cdiscount" | "darty";

const AMAZON_MARKET: Record<string, string> = {
  "amazon.fr": "FR",
  "amazon.de": "DE",
  "amazon.it": "IT",
  "amazon.es": "ES",
  "amazon.co.uk": "GB",
};

export function parseMerchantUrl(raw: string): { url: string; source: SupportedMerchant; market: string } | null {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  parsed.hash = "";
  const tracking = new Set(["gclid", "fbclid", "msclkid", "ref", "tag"]);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || tracking.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
  const amazonHost = Object.keys(AMAZON_MARKET).find((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (amazonHost) return { url: parsed.toString(), source: "amazon", market: AMAZON_MARKET[amazonHost] };
  if (hostname === "boulanger.com" || hostname.endsWith(".boulanger.com")) return { url: parsed.toString(), source: "boulanger", market: "FR" };
  if (hostname === "darty.com" || hostname.endsWith(".darty.com")) return { url: parsed.toString(), source: "darty", market: "FR" };
  if (hostname === "cdiscount.com" || hostname.endsWith(".cdiscount.com")) return { url: parsed.toString(), source: "cdiscount", market: "FR" };
  return null;
}
