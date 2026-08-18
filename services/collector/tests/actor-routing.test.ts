import assert from "node:assert/strict";
import test from "node:test";

import { rotateJdCoverageTargets, shouldIncludeRemoteTasks, shouldKeepAmazonObservation, shouldPersistFrontier } from "../src/actor.js";

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

test("les anciennes tâches Amazon respectent aussi le test Apple et Samsung", () => {
  const observation = (brand: string | null) => ({
    offer: { product: { brand } },
  }) as Parameters<typeof shouldKeepAmazonObservation>[1];

  assert.equal(shouldKeepAmazonObservation("amazon", observation("Apple"), ["Apple", "Samsung"]), true);
  assert.equal(shouldKeepAmazonObservation("amazon", observation("Samsung Electronics"), ["Apple", "Samsung"]), true);
  assert.equal(shouldKeepAmazonObservation("amazon", observation("ARCTIC"), ["Apple", "Samsung"]), false);
  assert.equal(shouldKeepAmazonObservation("amazon", observation("ARCTIC"), []), true);
  assert.equal(shouldKeepAmazonObservation("jd_sports", observation("Vans"), ["Apple", "Samsung"]), true);
});

test("répartit les six pages JD Sports sur trois passages pour limiter les blocages", () => {
  const targets = ["h0", "h72", "h144", "f0", "f72", "f144"];
  assert.deepEqual(rotateJdCoverageTargets(targets, 0), ["h0", "f0"]);
  assert.deepEqual(rotateJdCoverageTargets(targets, 30 * 60_000), ["h72", "f72"]);
  assert.deepEqual(rotateJdCoverageTargets(targets, 60 * 60_000), ["h144", "f144"]);
});
