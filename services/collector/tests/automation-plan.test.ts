import assert from "node:assert/strict";
import test from "node:test";

import { buildAutomationPlan } from "../src/automation-plan.js";

test("concentre le forfait Keepa API 20 sur Amazon France", () => {
  const [amazon] = buildAutomationPlan("user/prixradar", []);
  assert.equal(amazon?.name, "prixradar-amazon-eu5-api-20");
  assert.equal(amazon?.definition.cronExpression, "15,45 0,7-23 * * *");
  assert.equal(amazon?.definition.actions?.length, 1);
  const action = amazon?.definition.actions?.[0];
  assert.equal(action?.type, "RUN_ACTOR");
  if (!action || action.type !== "RUN_ACTOR") assert.fail("Action Actor attendue");
  const input = JSON.parse(action.runInput?.body ?? "{}") as Record<string, unknown>;
  assert.deepEqual(input.markets, ["FR"]);
  assert.equal(input.limit, 20);
  assert.equal(input.pageRotation, 12);
  assert.equal(input.minimumDropPercent, 30);
  assert.equal(input.notify, true);
  assert.equal(input.liveVerificationLimit, 0);
  assert.equal(input.verifyAmazonPage, false);
  assert.equal(input.useRemoteCoverage, false);
  assert.equal(input.useRemoteDiscovery, true);
  assert.equal(input.processEanScans, true);
});

test("récupère la couverture distante et teste les connecteurs chaque jour", () => {
  const remotePlan = buildAutomationPlan("actor", []);
  assert.equal(remotePlan.length, 7);
  const remoteAction = remotePlan[1]?.definition.actions?.[0];
  if (!remoteAction || remoteAction.type !== "RUN_ACTOR") assert.fail("Action retail attendue");
  const remoteInput = JSON.parse(remoteAction.runInput?.body ?? "{}") as Record<string, unknown>;
  assert.equal(remoteInput.useRemoteCoverage, true);
  assert.equal(remoteInput.scanAmazon, false);
  const plan = buildAutomationPlan("actor", ["https://www.boulanger.com/c/electromenager"]);
  assert.equal(plan.length, 7);
  assert.equal(plan[1]?.definition.cronExpression, "7,37 * * * *");
  assert.deepEqual(plan.slice(2, 5).map((schedule) => [schedule.name, schedule.definition.cronExpression]), [
    ["prixradar-facebook-7h30-7h45", "30,45 7 * * *"],
    ["prixradar-facebook-8h-14h45", "*/15 8-14 * * *"],
    ["prixradar-facebook-15h", "0 15 * * *"],
  ]);
  for (const socialSchedule of plan.slice(2, 5)) {
    assert.equal(socialSchedule.definition.isEnabled, true);
    const socialAction = socialSchedule.definition.actions?.[0];
    if (!socialAction || socialAction.type !== "RUN_ACTOR") assert.fail("Action sociale attendue");
    const socialInput = JSON.parse(socialAction.runInput?.body ?? "{}") as Record<string, unknown>;
    assert.equal(socialInput.mode, "social-dispatch");
    assert.equal(socialInput.notify, true);
    assert.equal(socialInput.browserFallback, false);
  }
  assert.equal(plan[5]?.definition.cronExpression, "17 6 * * *");
  assert.equal(plan[6]?.definition.cronExpression, "7 18 * * *");
  const digestAction = plan[6]?.definition.actions?.[0];
  if (!digestAction || digestAction.type !== "RUN_ACTOR") assert.fail("Action digest attendue");
  assert.equal(JSON.parse(digestAction.runInput?.body ?? "{}").mode, "digest");
});
