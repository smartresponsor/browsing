import assert from "node:assert/strict";
import fs from "node:fs";
import { settleClickTransition } from "../playwright-worker/src/click-transition-settle.js";

const definitions = fs.readFileSync(new URL("../mcp-server/src/core-domain-tool-definitions.cjs", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
const contract = fs.readFileSync(new URL("../mcp-server/src/capability-contract.js", import.meta.url), "utf8");

for (const token of [
  "canonicalName: 'browser.click'",
  "capabilityName: 'network.click'",
  "expectedTargetId: z.string().optional()",
  "expectedPageRevision: z.string().optional()",
  "expectedFormRevision: z.string().optional()",
  "correlation: networkExecutionCorrelationSchema.optional()",
]) {
  assert.equal(definitions.includes(token), true, `network.click definition invariant missing: ${token}`);
}

for (const token of [
  "const before = await capturePageArtifact(target, { screenshot: false });",
  "assertExpectedRevisions(expectedRevisionsFromBody(req.body), before);",
  "const after = await capturePageArtifact(target, { screenshot: false });",
  "NETWORK_CLICK_TRANSITION_VERIFIED",
  "NETWORK_CLICK_POSTCONDITION_UNVERIFIED",
  "retrySafe: false",
  "Do not automatically repeat the click.",
]) {
  assert.equal(worker.includes(token), true, `network.click runtime invariant missing: ${token}`);
}

assert.equal(
  contract.includes("executionCorrelation: 'console-owned-optional', postcondition: 'transition-observed-or-explicitly-unverified'"),
  true,
  "network.click contract must require Console-owned optional correlation and explicit transition verification semantics",
);

let captureCount = 0;
const before = {
  targetId: "target-1",
  url: "https://example.test/results",
  pageRevision: "page-a",
  formRevision: "form-a",
};
const initialAfter = { ...before };
const settled = await settleClickTransition({
  before,
  initialAfter,
  timeoutMs: 200,
  pollMs: 10,
  capture: async () => {
    captureCount += 1;
    return captureCount < 2
      ? { ...before }
      : { ...before, pageRevision: "page-b" };
  },
});
assert.equal(settled.settled, true, "delayed SPA revision change must be observed within the bounded settling window");
assert.equal(settled.transition.pageRevisionChanged, true, "settling must report the observed revision transition");
assert.equal(captureCount, 2, "settling must poll read-only evidence without replaying the click");

for (const token of [
  "settleClickTransition({",
  "observedDelayedTransition: settled.settled",
  "capture: () => capturePageArtifact(target, { screenshot: false })",
]) {
  assert.equal(worker.includes(token), true, `network.click settling invariant missing: ${token}`);
}

console.log("Network click revision/transition regression passed.");

