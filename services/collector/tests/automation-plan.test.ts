import assert from "node:assert/strict";
import test from "node:test";

import { buildAutomationPlan } from "../src/automation-plan.js";

test("limite le pilote Amazon EU5 à la capacité horaire de Keepa Pro", () => {
  const [amazon] = buildAutomationPlan("user/prixradar", []);
  assert.equal(amazon?.name, "prixradar-amazon-eu5-hourly");
  assert.equal(amazon?.definition.cronExpression, "11 * * * *");
  assert.equal(amazon?.definition.actions?.length, 1);
  const action = amazon?.definition.actions?.[0];
  assert.equal(action?.type, "RUN_ACTOR");
  if (!action || action.type !== "RUN_ACTOR") assert.fail("Action Actor attendue");
  const input = JSON.parse(action.runInput?.body ?? "{}") as Record<string, unknown>;
  assert.deepEqual(input.markets, ["FR", "DE", "IT", "ES", "GB"]);
  assert.equal(input.limit, 2);
  assert.equal(input.minimumDropPercent, 40);
  assert.equal(input.liveVerificationLimit, 0);
  assert.equal(input.verifyAmazonPage, false);
  assert.equal(input.notify, false);
  assert.equal(input.useRemoteCoverage, false);
  assert.equal(input.useRemoteDiscovery, false);
});

test("récupère la couverture distante et teste les connecteurs chaque jour", () => {
  const remotePlan = buildAutomationPlan("actor", []);
  assert.equal(remotePlan.length, 4);
  const remoteAction = remotePlan[1]?.definition.actions?.[0];
  if (!remoteAction || remoteAction.type !== "RUN_ACTOR") assert.fail("Action retail attendue");
  const remoteInput = JSON.parse(remoteAction.runInput?.body ?? "{}") as Record<string, unknown>;
  assert.equal(remoteInput.useRemoteCoverage, true);
  assert.equal(remoteInput.scanAmazon, false);
  const plan = buildAutomationPlan("actor", ["https://www.boulanger.com/c/electromenager"]);
  assert.equal(plan.length, 4);
  assert.equal(plan[1]?.definition.cronExpression, "7,37 * * * *");
  assert.equal(plan[2]?.definition.cronExpression, "17 6 * * *");
  assert.equal(plan[3]?.definition.cronExpression, "7 18 * * *");
  const digestAction = plan[3]?.definition.actions?.[0];
  if (!digestAction || digestAction.type !== "RUN_ACTOR") assert.fail("Action digest attendue");
  assert.equal(JSON.parse(digestAction.runInput?.body ?? "{}").mode, "digest");
});
