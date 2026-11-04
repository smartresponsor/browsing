import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyVisibleFailure, failureEnvelope } from "../playwright-worker/src/failure-envelope.js";

const source = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
const rateLimiter = fs.readFileSync(new URL("../playwright-worker/src/fill-rate-limiter.js", import.meta.url), "utf8");

for (const token of [
  "revisionError('WEB_FIELD_NOT_FOUND'",
  "revisionError('WEB_CONTROL_UNSUPPORTED'",
  "revisionError('WEB_APPROVAL_REQUIRED'",
  "revisionError('WEB_CLICK_TARGET_REQUIRED'",
  "revisionError('WEB_FINAL_ACTION_REQUIRES_SUBMIT_TOOL'",

  "revisionError('WEB_APPROVAL_STALE'",
]) {
  assert.equal(source.includes(token), true, `Stable Web status invariant missing: ${token}`);
}
assert.equal(source.includes("revisionError('WEB_SUBMIT_DISABLED'"), false, "Legacy global submit prohibition remains");
for (const code of ["WEB_RATE_LIMITED", "WEB_OPERATION_SIZE_LIMIT", "WEB_RATE_POLICY_INVALID"]) {
  assert.ok(rateLimiter.includes(code), `Bounded Web quota status missing: ${code}`);
}
assert.equal(source.includes("revisionError('WEB_OPERATION_LIMIT_REACHED'"), false, "Lifetime worker quota must not return");

assert.equal(classifyVisibleFailure({ reason: "VISIBLE_BROWSER_WINDOW_NOT_DETECTED" }), "WEB_VISIBLE_DESKTOP_MISSING");
assert.equal(classifyVisibleFailure({ reason: "WRONG_FOREGROUND_TARGET" }), "WEB_FOREGROUND_TARGET_MISMATCH");
const attachFailure = failureEnvelope({ code: "WEB_CDP_ATTACH_TIMEOUT", message: "timeout", targetId: "private-target" });
assert.equal(attachFailure.failed_gate, "cdp_attach");
assert.equal(attachFailure.retryable, true);
assert.equal(JSON.stringify(attachFailure).includes("private-target"), false);

for (const legacy of [
  "throw new Error('Explicit approvalText=APPLY is required for fill actions.')",
  "throw new Error('Explicit approvalText=SUBMIT is required for final submit actions.')",
  "throw new Error('Current page reviewHash does not match the approved reviewHash.",
  "throw new Error('Final submit or destructive clicks are not allowed through web.click.')",
]) {
  assert.equal(source.includes(legacy), false, `Legacy free-form semantic error remains: ${legacy}`);
}

console.log("Web semantic status taxonomy regression passed.");

