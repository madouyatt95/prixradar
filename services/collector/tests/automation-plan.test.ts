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
});

test("n’active le planning retail qu’avec des pages de départ explicites", () => {
  assert.equal(buildAutomationPlan("actor", []).length, 1);
  const plan = buildAutomationPlan("actor", ["https://www.boulanger.com/c/electromenager"]);
  assert.equal(plan.length, 2);
  assert.equal(plan[1]?.definition.cronExpression, "7,37 * * * *");
});
