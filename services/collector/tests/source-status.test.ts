import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { toSourceStatusEnvelope } from "../src/sink.js";
import {
  runReportedSourceAttempt,
  sourceAttempt,
  SourceStatusReporter,
} from "../src/source-status.js";
import type { SourceStatusEvent } from "../src/types.js";

function configuredCollector() {
  return loadConfig({
    PRICE_RADAR_BASE_URL: "https://prixradar.example",
    INGEST_SECRET: "INGEST_SECRET_AT_LEAST_24_CHARS",
    PUSH_DELIVERY_SECRET: "PUSH_SECRET_DISTINCT_AT_LEAST_24_CHARS",
  });
}

test("conserve le dernier succès lors d’un statut degraded et produit l’enveloppe attendue", async () => {
  const statuses: SourceStatusEvent[] = [];
  const dates = [
    new Date("2026-07-21T10:00:00.000Z"),
    new Date("2026-07-21T10:05:00.000Z"),
  ];
  const reporter = new SourceStatusReporter(configuredCollector(), {
    now: () => dates.shift() ?? new Date("2026-07-21T10:05:00.000Z"),
    send: async (status) => { statuses.push(status); },
  });
  const attempt = sourceAttempt("darty", "FR", false);

  assert.equal(await reporter.healthy(attempt, {
    productsSeen: 12,
    queueLag: 0,
    sourceConfigurationId: "darty:fr:coverage-a",
    nextPageCursor: "https://www.darty.com/nav/page-2?page=2",
  }), true);
  assert.equal(await reporter.degraded(attempt, {
    productsSeen: 0,
    queueLag: 0,
    sourceConfigurationId: "darty:fr:coverage-a",
  }, "HTTP_503"), true);

  assert.equal(statuses.length, 2);
  assert.equal(statuses[0]?.status, "healthy");
  assert.equal(statuses[0]?.sourceConfigurationId, "darty:fr:coverage-a");
  assert.equal(statuses[0]?.lastSuccessAt, "2026-07-21T10:00:00.000Z");
  assert.equal(statuses[1]?.status, "degraded");
  assert.equal(statuses[1]?.lastSuccessAt, "2026-07-21T10:00:00.000Z");
  assert.equal(statuses[1]?.lastAttemptAt, "2026-07-21T10:05:00.000Z");
  assert.equal(statuses[1]?.queueLag, 0);

  const scopedEnvelope = toSourceStatusEnvelope(statuses[0] as SourceStatusEvent);
  assert.equal(scopedEnvelope.payload.sourceConfigurationId, "darty:fr:coverage-a");
  assert.equal(scopedEnvelope.payload.nextPageCursor, "https://www.darty.com/nav/page-2?page=2");
  const envelope = toSourceStatusEnvelope(statuses[1] as SourceStatusEvent);
  assert.equal(envelope.eventType, "source_status");
  assert.equal(envelope.source, "darty");
  assert.equal(envelope.payload.id, "darty:FR");
  assert.equal(envelope.payload.sourceConfigurationId, "darty:fr:coverage-a");
  assert.equal(envelope.payload.lastErrorCode, "HTTP_503");
});

test("n’attribue jamais le succès d’une page à une autre page en échec", async () => {
  const statuses: SourceStatusEvent[] = [];
  const reporter = new SourceStatusReporter(configuredCollector(), {
    send: async (status) => { statuses.push(status); },
  });
  const attempt = sourceAttempt("darty", "FR", false);
  await reporter.healthy(attempt, { productsSeen: 12, queueLag: 0, sourceConfigurationId: "darty:fr:page-a" });
  await reporter.degraded(attempt, { productsSeen: 0, queueLag: 0, sourceConfigurationId: "darty:fr:page-b" }, "HTTP_503");
  assert.equal(statuses[0]?.lastSuccessAt === null, false);
  assert.equal(statuses[1]?.lastSuccessAt, null);
});

test("conserve le segment de couverture même lorsque son crawl échoue", async () => {
  const statuses: SourceStatusEvent[] = [];
  const reporter = new SourceStatusReporter(configuredCollector(), {
    send: async (status) => { statuses.push(status); },
  });
  await assert.rejects(runReportedSourceAttempt({
    reporter,
    attempt: sourceAttempt("boulanger", "FR", false),
    baseMetrics: { sourceConfigurationId: "boulanger:fr:coverage-b" },
    run: async () => { throw new Error("HTTP 429"); },
    productsSeen: () => 0,
    queueLag: () => 0,
  }));
  assert.equal(statuses[0]?.sourceConfigurationId, "boulanger:fr:coverage-b");
  assert.equal(statuses[0]?.antiBotBlocked, true);
});

test("publie un curseur avancé même lorsque toutes les fiches de la page échouent", async () => {
  const statuses: SourceStatusEvent[] = [];
  const reporter = new SourceStatusReporter(configuredCollector(), {
    send: async (status) => { statuses.push(status); },
  });
  const result = await runReportedSourceAttempt({
    reporter,
    attempt: sourceAttempt("cdiscount", "FR", false),
    baseMetrics: { sourceConfigurationId: "cdiscount:fr:page-a" },
    run: async () => ({
      productsSeen: 0,
      failures: 3,
      nextPageCursor: "https://www.cdiscount.com/high-tech/page.html?page=2",
    }),
    productsSeen: (value) => value.productsSeen,
    metrics: (value) => ({ nextPageCursor: value.nextPageCursor }),
    degradedErrorCode: (value) => value.failures > 0 ? "PRODUCT_VERIFICATION_FAILED" : null,
    queueLag: () => 0,
  });
  assert.equal(result.failures, 3);
  assert.equal(statuses[0]?.status, "degraded");
  assert.equal(statuses[0]?.nextPageCursor, "https://www.cdiscount.com/high-tech/page.html?page=2");
});

test("une panne de publication de statut ne masque jamais l’erreur principale", async () => {
  const primary = new Error("échec principal du crawl");
  let statusErrors = 0;
  const reporter = new SourceStatusReporter(configuredCollector(), {
    send: async () => { throw new Error("échec secondaire du status"); },
    onError: () => { statusErrors += 1; },
  });

  await assert.rejects(
    runReportedSourceAttempt({
      reporter,
      attempt: sourceAttempt("cdiscount", "FR", false),
      run: async () => { throw primary; },
      productsSeen: () => 0,
      queueLag: async () => { throw new Error("métrique indisponible"); },
    }),
    (error: unknown) => error === primary,
  );
  assert.equal(statusErrors, 1);
});

test("un mode fixture ne publie aucun statut externe", async () => {
  let sent = 0;
  const reporter = new SourceStatusReporter(configuredCollector(), {
    send: async () => { sent += 1; },
  });
  const result = await runReportedSourceAttempt({
    reporter,
    attempt: sourceAttempt("boulanger", "FR", true),
    run: async () => 4,
    productsSeen: (count) => count,
    queueLag: () => 0,
  });
  assert.equal(result, 4);
  assert.equal(sent, 0);
});
