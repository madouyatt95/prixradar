import assert from "node:assert/strict";
import test from "node:test";

import { shouldIncludeRemoteTasks, shouldPersistFrontier } from "../src/actor.js";

test("réserve le passage JD Sports aux pages de couverture", () => {
  assert.equal(shouldIncludeRemoteTasks("jd_sports", false), false);
  assert.equal(shouldIncludeRemoteTasks("amazon", false), true);
  assert.equal(shouldIncludeRemoteTasks("all", false), true);
  assert.equal(shouldIncludeRemoteTasks("jd_sports", true), false);
});

test("n'alimente pas une file de fiches JD Sports depuis les cartes catégorie", () => {
  assert.equal(shouldPersistFrontier("jd_sports"), false);
  assert.equal(shouldPersistFrontier("boulanger"), true);
});
