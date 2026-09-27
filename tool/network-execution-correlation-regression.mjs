import assert from "node:assert/strict";
import fs from "node:fs";

const definitions = fs.readFileSync(new URL("../mcp-server/src/core-domain-tool-definitions.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "const networkExecutionCorrelationSchema = z.object({",
  "taskId: z.string().min(1).max(200).optional()",
  "runId: z.string().min(1).max(200).optional()",
  "invocationId: z.string().min(1).max(200).optional()",
  "correlation: networkExecutionCorrelationSchema.optional()",
]) {
  assert.equal(definitions.includes(token), true, `Network MCP correlation definition invariant missing: ${token}`);
}

for (const token of [
  "function normalizeExecutionCorrelation(body)",
  "executionOwner: 'console-mcp'",
  "const correlation = normalizeExecutionCorrelation(req.body);",
  "status: 'NETWORK_FORM_MUTATION_VERIFIED'",
  "status: 'NETWORK_UPLOAD_VERIFIED'",
  "status: verified ? 'NETWORK_CLICK_TRANSITION_VERIFIED' : 'NETWORK_CLICK_POSTCONDITION_UNVERIFIED'",
  "action: 'submit_after_approval'",
  "sendNetworkError(res, error, 'NETWORK_FORM_MUTATION_FAILED', correlation)",
  "sendNetworkError(res, error, 'NETWORK_UPLOAD_FAILED', correlation)",
  "sendNetworkError(res, error, 'NETWORK_CLICK_FAILED', correlation)",
  "sendNetworkError(res, error, 'NETWORK_SUBMIT_FAILED', correlation)",
]) {
  assert.equal(worker.includes(token), true, `Network worker correlation invariant missing: ${token}`);
}

const correlationCaptureCount = (worker.match(/const correlation = normalizeExecutionCorrelation\(req\.body\);/g) || []).length;
assert.ok(correlationCaptureCount >= 4, "fill/upload/click/submit must each capture Console-owned correlation");

assert.equal(
  worker.includes("genericExecutionLeaseOwnedByNetwork"),
  false,
  "Network worker must not implement generic execution lease ownership",
);

console.log("Network Console execution correlation regression passed.");

