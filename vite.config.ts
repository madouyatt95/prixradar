import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
const PRODUCTION_DATABASE_ID = "d834f03b-6a92-4d42-93eb-5b7e7154cd5f";

const { d1, r2 } = hostingConfig;
const databaseId =
  process.env.D1_DATABASE_ID?.trim() ||
  (process.env.CI === "true"
    ? PRODUCTION_DATABASE_ID
    : SITE_CREATOR_PLACEHOLDER_DATABASE_ID);

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  // Keep the generated Wrangler config aligned with the public Worker URL.
  // Without an explicit name, the Cloudflare plugin falls back to the npm
  // package name (`prixradar-pwa`) and deploys a second Worker.
  name: "prixradar",
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  compatibility_date: "2026-07-21",
  triggers: {
    crons: ["*/5 * * * *"],
  },
  vars: {
    // Keep the administration cost center aligned with the active Keepa API 20 plan.
    // `wrangler deploy --keep-vars` preserves the other dashboard-managed values.
    KEEPA_MONTHLY_COST_CENTS: "4900",
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "prixradar-d1",
          database_id: databaseId,
          migrations_dir: "drizzle",
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
