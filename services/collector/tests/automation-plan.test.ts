import assert from "node:assert/strict";
import test from "node:test";

import { buildAutomationPlan } from "../src/automation-plan.js";

test("regroupe Amazon EU5 dans un seul Actor toutes les quinze minutes", () => {
  const [amazon] = buildAutomationPlan("user/prixradar", []);
  assert.equal(amazon?.definition.cronExpression, "*/15 * * * *");
  assert.equal(amazon?.definition.actions?.length, 1);
  const action = amazon?.definition.actions?.[0];
  assert.equal(action?.type, "RUN_ACTOR");
  if (!action || action.type !== "RUN_ACTOR") assert.fail("Action Actor attendue");
  const input = JSON.parse(action.runInput?.body ?? "{}") as Record<string, unknown>;
  assert.deepEqual(input.markets, ["FR", "DE", "IT", "ES", "GB"]);
  assert.equal(input.liveVerificationLimit, 5);
  assert.equal(input.notify, true);
  assert.equal(input.useRemoteDiscovery, true);
});

test("récupère la couverture distante et teste les connecteurs chaque jour", () => {
  const remotePlan = buildAutomationPlan("actor", []);
  assert.equal(remotePlan.length, 3);
  const remoteAction = remotePlan[1]?.definition.actions?.[0];
  if (!remoteAction || remoteAction.type !== "RUN_ACTOR") assert.fail("Action retail attendue");
  const remoteInput = JSON.parse(remoteAction.runInput?.body ?? "{}") as Record<string, unknown>;
  assert.equal(remoteInput.useRemoteCoverage, true);
  assert.equal(remoteInput.scanAmazon, false);
  const plan = buildAutomationPlan("actor", ["https://www.boulanger.com/c/electromenager"]);
  assert.equal(plan.length, 3);
  assert.equal(plan[1]?.definition.cronExpression, "7,37 * * * *");
  assert.equal(plan[2]?.definition.cronExpression, "17 6 * * *");
});
