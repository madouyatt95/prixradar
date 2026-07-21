const api = globalThis.browser ?? globalThis.chrome;
const DEFAULT_BASE_URL = "https://prixradar-seven.vercel.app";
const SUPPORTED_HOSTS = /(^|\.)(amazon\.(fr|de|it|es|co\.uk)|boulanger\.com|darty\.com|cdiscount\.com)$/i;

async function activeUrl() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url ?? null;
}

async function baseUrl() {
  const stored = await api.storage.sync.get("prixRadarBaseUrl");
  return typeof stored.prixRadarBaseUrl === "string" ? stored.prixRadarBaseUrl : DEFAULT_BASE_URL;
}

const button = document.querySelector("#inspect");
const status = document.querySelector("#status");

activeUrl().then((raw) => {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !SUPPORTED_HOSTS.test(url.hostname)) throw new Error("unsupported");
    status.textContent = `Page reconnue : ${url.hostname.replace(/^www\./i, "")}`;
  } catch {
    button.disabled = true;
    status.textContent = "Ouvrez une fiche Amazon Europe, Boulanger, Darty ou Cdiscount.";
  }
});

button.addEventListener("click", async () => {
  const [raw, base] = await Promise.all([activeUrl(), baseUrl()]);
  if (!raw) return;
  const destination = new URL("/share", base);
  destination.searchParams.set("url", raw);
  destination.searchParams.set("source", "safari-extension");
  await api.tabs.create({ url: destination.toString() });
  globalThis.close();
});
