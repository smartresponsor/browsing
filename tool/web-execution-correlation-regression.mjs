import assert from "node:assert/strict";
import fs from "node:fs";

const definitions = fs.readFileSync(new URL("../mcp-server/src/web-domain-tool-definitions.cjs", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "const webExecutionCorrelationSchema = z.object({",
  "taskId: z.string().min(1).max(200).optional()",
  "runId: z.string().min(1).max(200).optional()",
  "invocationId: z.string().min(1).max(200).optional()",
  "correlation: webExecutionCorrelationSchema.optional()",
]) {
  assert.equal(definitions.includes(token), true, `Browser MCP correlation definition invariant missing: ${token}`);
}

for (const token of [
  "function normalizeExecutionCorrelation(body)",
  "executionOwner: 'console-mcp'",
  "const correlation = normalizeExecutionCorrelation(req.body);",
  "status: 'WEB_FORM_MUTATION_VERIFIED'",
  "status: 'WEB_UPLOAD_VERIFIED'",
  "status: verified ? 'WEB_CLICK_TRANSITION_VERIFIED' : 'WEB_CLICK_POSTCONDITION_UNVERIFIED'",
  "action: 'submit_after_approval'",
  "sendWebError(res, error, 'WEB_FORM_MUTATION_FAILED', correlation)",
  "sendWebError(res, error, 'WEB_UPLOAD_FAILED', correlation)",
  "sendWebError(res, error, 'WEB_CLICK_FAILED', correlation)",
  "sendWebError(res, error, 'WEB_SUBMIT_FAILED', correlation)",
]) {
  assert.equal(worker.includes(token), true, `Web worker correlation invariant missing: ${token}`);
}

const correlationCaptureCount = (worker.match(/const correlation = normalizeExecutionCorrelation\(req\.body\);/g) || []).length;
assert.ok(correlationCaptureCount >= 4, "fill/upload/click/submit must each capture Console-owned correlation");

assert.equal(
  worker.includes("genericExecutionLeaseOwnedByWeb"),
  false,
  "Web worker must not implement generic execution lease ownership",
);

console.log("Web Console execution correlation regression passed.");
