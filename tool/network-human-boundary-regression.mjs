import assert from "node:assert/strict";
import fs from "node:fs";

import { classifyChallengeText } from "../playwright-worker/src/human-boundary.js";

assert.equal(classifyChallengeText("Welcome to the application"), null);
assert.equal(classifyChallengeText("Please verify you are human to continue")?.type, "captcha");
assert.equal(classifyChallengeText("Enter your two-factor authentication code")?.type, "two_factor");
assert.equal(classifyChallengeText("Security check: unusual activity detected")?.type, "security_challenge");

const workerSource = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
for (const token of [
  "'NETWORK_HUMAN_ACTION_REQUIRED'",
  "requestedAction: boundary.requestedAction",
  "resumeCondition:",
  "sendNetworkError(res, error, 'NETWORK_PAGE_CAPTURE_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_INSPECT_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_FORM_EXTRACT_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_CLICK_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_REVIEW_CAPTURE_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_OPEN_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_OPEN_JOB_FAILED')",
]) {
  assert.equal(workerSource.includes(token), true, `Human-boundary propagation invariant missing: ${token}`);
}

console.log("Network human-boundary regression passed.");

