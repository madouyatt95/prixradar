import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/alert-evidence.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const evidence = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("push filters read history depth from the persisted analysis evidence", () => {
  const nested = JSON.stringify({ notificationEligible: true, analysis: { historyPoints: 8, checks: { exactVariant: true } } });
  assert.equal(evidence.evidenceNumber(nested, "historyPoints"), 8);
  assert.equal(evidence.evidenceBoolean(nested, "exactVariant"), true);
  assert.equal(evidence.evidenceEligible(nested), true);
});

test("legacy root evidence remains readable and malformed evidence fails closed", () => {
  assert.equal(evidence.evidenceNumber(JSON.stringify({ historyPoints: 6 }), "historyPoints"), 6);
  assert.equal(evidence.evidenceNumber("not-json", "historyPoints"), null);
  assert.equal(evidence.evidenceEligible("not-json"), false);
});
