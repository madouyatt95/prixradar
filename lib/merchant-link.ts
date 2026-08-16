export function canonicalMerchantProductUrl(source: string, raw: string): string {
  if (source !== "jd_sports") return raw;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./u, "");
    if (parsed.protocol !== "https:" || (host !== "jdsports.fr" && host !== "m.jdsports.fr")) return raw;
    parsed.hostname = "www.jdsports.fr";
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/`;
    return parsed.toString();
  } catch {
    return raw;
  }
}
