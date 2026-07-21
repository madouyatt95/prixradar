import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const applicationRegistry = await readFile(new URL("../lib/source-registry.ts", import.meta.url), "utf8");
const collectorRegistry = await readFile(new URL("../services/collector/src/connectors/index.ts", import.meta.url), "utf8");

test("the public coverage registry matches the deployed collector contract", () => {
  const applicationVersion = applicationRegistry.match(/SOURCE_REGISTRY_VERSION = "([^"]+)"/)?.[1];
  const collectorVersion = collectorRegistry.match(/CONNECTOR_REGISTRY_VERSION = "([^"]+)"/)?.[1];
  assert.equal(applicationVersion, collectorVersion);
  assert.match(applicationRegistry, /id: "amazon"[\s\S]*?markets: \["FR", "DE", "IT", "ES", "GB"\]/);
  assert.match(applicationRegistry, /id: "fnac"[\s\S]*?status: "planned"/);
  assert.match(applicationRegistry, /source\.status === "active"/);
});
