import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "revisionError('WEB_FIELD_NOT_FOUND'",
  "revisionError('WEB_CONTROL_UNSUPPORTED'",
  "revisionError('WEB_APPROVAL_REQUIRED'",
  "revisionError('WEB_OPERATION_LIMIT_REACHED'",
  "revisionError('WEB_CLICK_TARGET_REQUIRED'",
  "revisionError('WEB_FINAL_ACTION_REQUIRES_SUBMIT_TOOL'",
  "revisionError('WEB_SUBMIT_DISABLED'",
  "revisionError('WEB_APPROVAL_STALE'",
]) {
  assert.equal(source.includes(token), true, `Stable Web status invariant missing: ${token}`);
}

for (const legacy of [
  "throw new Error('Explicit approvalText=APPLY is required for fill actions.')",
  "throw new Error('Explicit approvalText=SUBMIT is required for final submit actions.')",
  "throw new Error('Current page reviewHash does not match the approved reviewHash.",
  "throw new Error('Final submit or destructive clicks are not allowed through web.click.')",
]) {
  assert.equal(source.includes(legacy), false, `Legacy free-form semantic error remains: ${legacy}`);
}

console.log("Web semantic status taxonomy regression passed.");

