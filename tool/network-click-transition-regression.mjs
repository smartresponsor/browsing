import assert from "node:assert/strict";
import fs from "node:fs";

const bundle = fs.readFileSync(new URL("../mcp-server/src/network-tool-bundle.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
const contract = fs.readFileSync(new URL("../mcp-server/src/capability-contract.js", import.meta.url), "utf8");

for (const token of [
  "expectedTargetId: z.string().optional()",
  "expectedPageRevision: z.string().optional()",
  "expectedFormRevision: z.string().optional()",
  "correlation: networkExecutionCorrelationSchema.optional()",
]) {
  assert.equal(bundle.includes(token), true, `network.click schema invariant missing: ${token}`);
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

console.log("Network click revision/transition regression passed.");

