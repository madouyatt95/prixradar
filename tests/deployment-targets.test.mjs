import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("selects the native Next build on Vercel and vinext on Cloudflare", async () => {
  const [packageJson, selector] = await Promise.all([
    source("../package.json"),
    source("../build/run-build.mjs"),
  ]);
  const scripts = JSON.parse(packageJson).scripts;

  assert.equal(scripts.build, "node build/run-build.mjs");
  assert.match(scripts["build:vercel"], /next build/);
  assert.match(scripts["build:cloudflare"], /vinext build/);
  assert.match(selector, /process\.env\.VERCEL === "1"/);
});

test("injects Cloudflare bindings without importing them in Vercel bundles", async () => {
  const [runtimeEnv, worker, health] = await Promise.all([
    source("../lib/runtime-env.ts"),
    source("../worker/index.ts"),
    source("../app/api/health/route.ts"),
  ]);

  assert.doesNotMatch(runtimeEnv, /cloudflare:workers/);
  assert.match(runtimeEnv, /__PRIXRADAR_RUNTIME_ENV__/);
  assert.match(worker, /setRuntimeEnv\(env\)/);
  assert.match(health, /runtimeEnv as env/);
  assert.match(health, /version: "0\.7\.0"/);
});
