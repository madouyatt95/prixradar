import assert from "node:assert/strict";
import test from "node:test";

import { parseCoverageTargets } from "../src/coverage-plan.js";

test("reprend le curseur de page et la limite propres à chaque segment", () => {
  const [target] = parseCoverageTargets([{
    id: "darty:fr:segment-a",
    discoveryUrl: "https://www.darty.com/nav/achat/rayon/index.html",
    discoveryStrategy: "links",
    pageCursor: "https://www.darty.com/nav/achat/rayon/index.html?page=2",
    productLimit: 42,
  }]);
  assert.equal(target?.url, "https://www.darty.com/nav/achat/rayon/index.html?page=2");
  assert.equal(target?.productLimit, 42);
  assert.equal(target?.sourceConfigurationId, "darty:fr:segment-a");
});

test("refuse un curseur qui sort de l’enseigne du segment", () => {
  const targets = parseCoverageTargets([{
    id: "darty:fr:segment-a",
    discoveryUrl: "https://www.darty.com/nav/achat/rayon/index.html",
    discoveryStrategy: "links",
    pageCursor: "https://www.cdiscount.com/high-tech/index.html?page=2",
    productLimit: 1_000,
  }]);
  assert.deepEqual(targets, []);
});
