import { scanSourceUrl, verifySourceUrl } from "./crawler.js";
import { loadConfig, type CollectorConfig } from "./config.js";
import { connectorForUrl } from "./connectors/index.js";
import { KeepaClient, scanKeepaMarket } from "./keepa.js";
import { logger } from "./logger.js";
import { CollectorQueue, createCollectorWorker, type CollectorJob } from "./queue.js";
import { sendPushForObservation } from "./push.js";
import { postObservation } from "./sink.js";
import {
  runReportedSourceAttempt,
  sourceAttempt,
  SourceStatusReporter,
  type SourceAttempt,
} from "./source-status.js";
import type { VerifiedObservation } from "./types.js";

export async function deliverObservation(
  observation: VerifiedObservation,
  config: CollectorConfig,
  options: { allowPush?: boolean } = {},
): Promise<void> {
  if (observation.offer.fixture) {
    logger.info("fixture_skipped", { productKey: observation.offer.product.productKey });
    return;
  }
  if (!config.priceRadarBaseUrl || !config.ingestSecret) {
    logger.warn("ingest_not_configured", { productKey: observation.offer.product.productKey });
    return;
  }
  const ingested = await postObservation(observation, {
    baseUrl: config.priceRadarBaseUrl,
    ingestSecret: config.ingestSecret,
    ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
    timeoutMs: config.httpTimeoutMs,
    requestNotification: options.allowPush ?? true,
  });
  logger.info("observation_ingested", {
    productKey: observation.offer.product.productKey,
    accepted: ingested.accepted,
    duplicate: ingested.duplicate,
    alertId: ingested.alert?.id,
    backendScore: ingested.alert?.score,
    backendEligible: ingested.alert?.notificationEligible,
  });
  if (options.allowPush === false || !ingested.alert?.notificationEligible || !config.pushDeliverySecret || !config.vapidSubject
    || !config.vapidPublicKey || !config.vapidPrivateKey) return;

  const result = await sendPushForObservation(ingested.alert.id, ingested.alert.score, observation, {
    baseUrl: config.priceRadarBaseUrl,
    deliverySecret: config.pushDeliverySecret,
    ...(config.sitesAuthToken ? { sitesAuthToken: config.sitesAuthToken } : {}),
    vapidSubject: config.vapidSubject,
    vapidPublicKey: config.vapidPublicKey,
    vapidPrivateKey: config.vapidPrivateKey,
    timeoutMs: config.httpTimeoutMs,
  });
  logger.info("push_delivery_completed", { alertId: ingested.alert.id, ...result });
}

function sourceAttemptForJob(job: CollectorJob): SourceAttempt {
  if (job.kind === "scan-keepa") return sourceAttempt("amazon", job.market, job.fixture);
  const connector = connectorForUrl(job.url);
  return sourceAttempt(connector.source, connector.market, job.fixture);
}

export async function processCollectorJob(
  job: CollectorJob,
  queue: CollectorQueue,
  config: CollectorConfig,
): Promise<Record<string, unknown>> {
  const scanOptions = {
    browserFallback: config.browserFallback,
    fixture: job.fixture,
    timeoutMs: config.httpTimeoutMs,
    maxDiscoveredUrls: config.maxDiscoveredUrls,
    proxyUrls: config.proxyUrls,
  };

  if (job.kind === "discover-source") {
    const scan = await scanSourceUrl(job.url, scanOptions);
    const ids = await Promise.all(scan.discoveredUrls.map((url) => queue.add({
      kind: "verify-source",
      url,
      fixture: job.fixture,
    })));
    return { transport: scan.transport, discovered: scan.discoveredUrls.length, enqueued: ids.length };
  }

  if (job.kind === "verify-source") {
    const observation = await verifySourceUrl(job.url, {
      ...scanOptions,
      verifyDelayMs: config.verifyDelayMs,
    });
    await deliverObservation(observation, config);
    return {
      status: observation.verification.status,
      score: observation.anomaly.score,
      fixture: observation.offer.fixture,
    };
  }

  if (!config.keepaApiKey) throw new Error("KEEPA_API_KEY absente: scan Keepa indisponible.");
  const client = new KeepaClient({
    apiKey: config.keepaApiKey,
    timeoutMs: config.httpTimeoutMs,
    maxQuotaWaitMs: config.keepaMaxQuotaWaitMs,
  });
  const observations = await scanKeepaMarket(client, job.market, { limit: job.limit, fixture: job.fixture });
  for (const observation of observations) await deliverObservation(observation, config);
  return { market: job.market, observations: observations.length, quota: client.quota };
}

export async function runWorker(config: CollectorConfig = loadConfig()): Promise<void> {
  const queue = new CollectorQueue(config.redisUrl);
  const statusReporter = new SourceStatusReporter(config);
  const { worker } = createCollectorWorker(config.redisUrl, async (job) => {
    logger.info("job_started", { id: job.id, name: job.name, kind: job.data.kind });
    const result = await runReportedSourceAttempt({
      reporter: statusReporter,
      attempt: sourceAttemptForJob(job.data),
      run: () => processCollectorJob(job.data, queue, config),
      productsSeen: (value) => Number(value.observations ?? value.discovered ?? (value.status ? 1 : 0)),
      queueLag: () => queue.queue.getWaitingCount(),
    });
    logger.info("job_completed", { id: job.id, kind: job.data.kind, result });
    return result;
  });
  worker.on("failed", (job, error) => logger.error("job_failed", { id: job?.id, kind: job?.data.kind, error }));
  worker.on("error", (error) => logger.error("worker_error", { error }));

  const shutdown = async () => {
    logger.info("worker_stopping");
    await worker.close();
    await queue.close();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  logger.info("worker_ready", { queue: "prixradar-collector-v1", concurrency: 4, rateLimitPerMinute: 20 });
}
