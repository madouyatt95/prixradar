#!/usr/bin/env node
import { runActor } from "./actor.js";
import { scanSourceUrl, verifySourceUrl } from "./crawler.js";
import { loadConfig } from "./config.js";
import { KeepaClient, scanKeepaMarket } from "./keepa.js";
import { CollectorQueue } from "./queue.js";
import type { Market } from "./types.js";
import { deliverObservation, runWorker } from "./worker.js";

const HELP = `PrixRadar collector

Usage:
  npm run scan-source -- <https-url> [--browser] [--fixture] [--enqueue]
  npm run scan-keepa -- [FR,DE,IT,ES,GB] [--limit=25] [--fixture]
  npm run worker
  npm run actor

HTTP/JSON-LD est toujours tenté avant Playwright. --browser autorise seulement
le repli navigateur. Une fixture n'est jamais ingérée ni notifiée.`;

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function option(args: readonly string[], name: string): string | null {
  const prefix = `${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function output(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function scanSource(args: string[]): Promise<void> {
  const url = args.find((argument) => !argument.startsWith("--"));
  if (!url) throw new Error("URL manquante pour scan-source.");
  const config = loadConfig();
  const fixture = hasFlag(args, "--fixture");
  if (hasFlag(args, "--enqueue")) {
    const queue = new CollectorQueue(config.redisUrl);
    try {
      const jobId = await queue.add({ kind: "discover-source", url, fixture });
      output({ ok: true, queued: true, jobId, fixture });
    } finally {
      await queue.close();
    }
    return;
  }

  const options = {
    browserFallback: hasFlag(args, "--browser") || config.browserFallback,
    fixture,
    timeoutMs: config.httpTimeoutMs,
    maxDiscoveredUrls: config.maxDiscoveredUrls,
    proxyUrls: config.proxyUrls,
  };
  const initial = await scanSourceUrl(url, options);
  if (initial.offers.length === 0) {
    output({ ok: true, dataKind: "discovery", ...initial });
    return;
  }
  const observation = await verifySourceUrl(url, { ...options, verifyDelayMs: config.verifyDelayMs });
  await deliverObservation(observation, config);
  output({ ok: true, dataKind: "verified-observation", observation });
}

async function scanKeepa(args: string[]): Promise<void> {
  const config = loadConfig();
  if (!config.keepaApiKey) throw new Error("KEEPA_API_KEY absente; aucun résultat simulé n’est substitué.");
  const marketArgument = args.find((argument) => !argument.startsWith("--"));
  const requested = (marketArgument ?? config.keepaMarkets.join(","))
    .split(",")
    .map((market) => market.trim().toUpperCase()) as Market[];
  const supported = new Set<Market>(["FR", "DE", "IT", "ES", "GB"]);
  if (requested.some((market) => !supported.has(market))) throw new Error("Marché Keepa non pris en charge.");
  const limit = Math.max(1, Math.min(100, Number(option(args, "--limit") ?? 25)));
  const fixture = hasFlag(args, "--fixture");
  const client = new KeepaClient({
    apiKey: config.keepaApiKey,
    timeoutMs: config.httpTimeoutMs,
    maxQuotaWaitMs: config.keepaMaxQuotaWaitMs,
  });
  const results = [];
  for (const market of requested) {
    const observations = await scanKeepaMarket(client, market, { limit, fixture });
    for (const observation of observations) await deliverObservation(observation, config);
    results.push({ market, count: observations.length, observations });
  }
  output({ ok: true, dataKind: "keepa-scan", fixture, quota: client.quota, results });
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (command === "scan-source") return scanSource(args);
  if (command === "scan-keepa") return scanKeepa(args);
  if (command === "worker") return runWorker(loadConfig());
  if (command === "actor") return runActor(loadConfig());
  throw new Error(`Commande inconnue: ${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Erreur inconnue du collecteur.";
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});
