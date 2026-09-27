import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "const shadowPath = [];",
  "let shadowRoot = node.getRootNode();",
  "while (shadowRoot && shadowRoot.host)",
  "shadowPath.unshift({",
  "shadowPath,",
  "shadowDepth: shadowPath.length",
  "shadowPath: field.shadowPath",
  "semanticModelVersion: 4",
  "const actualShadowPath = await locator.evaluate(node => {",
  "const expectedShadowPath = Array.isArray(field?.shadowPath) ? field.shadowPath : []",
  "hashStableJson(actualShadowPath) !== hashStableJson(expectedShadowPath)",
  "'NETWORK_SHADOW_PATH_STALE'",
  "The open-shadow host path for this control changed.",
]) {
  assert.equal(worker.includes(token), true, `Shadow-path invariant missing: ${token}`);
}

assert.equal(
  worker.includes("closedShadowRoot"),
  false,
  "Closed shadow roots must not be represented as automatable semantic identity.",
);

console.log("Network open-shadow identity regression passed.");

