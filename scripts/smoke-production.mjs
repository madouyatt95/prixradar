const baseUrl = process.env.PRIXRADAR_SMOKE_URL?.replace(/\/$/u, "");

if (!baseUrl || !/^https:\/\//u.test(baseUrl)) {
  console.error("Définissez PRIXRADAR_SMOKE_URL avec une URL HTTPS de production.");
  process.exit(2);
}

const checks = [
  {
    path: "/",
    validate: async (response) => response.ok && (await response.text()).includes("PrixRadar"),
    label: "application",
  },
  {
    path: "/manifest.webmanifest",
    validate: async (response) => {
      if (!response.ok) return false;
      const manifest = await response.json();
      return manifest.name === "PrixRadar" && manifest.display === "standalone";
    },
    label: "manifeste PWA",
  },
  {
    path: "/api/health",
    validate: async (response) => {
      if (!response.ok) return false;
      const health = await response.json();
      return health.service === "prixradar" && health.runtime === "cloudflare-d1";
    },
    label: "API et D1",
  },
];

let failed = false;
for (const check of checks) {
  try {
    const response = await fetch(`${baseUrl}${check.path}`, {
      headers: { accept: "application/json,text/html;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const valid = await check.validate(response);
    console.log(`${valid ? "✓" : "✗"} ${check.label} (${response.status})`);
    failed ||= !valid;
  } catch (error) {
    console.error(`✗ ${check.label}: ${error instanceof Error ? error.message : "erreur réseau"}`);
    failed = true;
  }
}

process.exitCode = failed ? 1 : 0;
