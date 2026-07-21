const api = globalThis.browser ?? globalThis.chrome;
const input = document.querySelector("#base");
const status = document.querySelector("#status");
const DEFAULT_BASE_URL = "https://prixradar-seven.vercel.app";

api.storage.sync.get("prixRadarBaseUrl").then((stored) => {
  input.value = typeof stored.prixRadarBaseUrl === "string" ? stored.prixRadarBaseUrl : DEFAULT_BASE_URL;
});

document.querySelector("#options").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const url = new URL(input.value.trim());
    if (url.protocol !== "https:") throw new Error("https");
    await api.storage.sync.set({ prixRadarBaseUrl: url.origin });
    status.textContent = "Adresse enregistrée.";
  } catch {
    status.textContent = "Utilisez une adresse HTTPS valide.";
  }
});
