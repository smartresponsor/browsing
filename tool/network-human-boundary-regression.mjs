import assert from "node:assert/strict";
import fs from "node:fs";

import { classifyChallengeText, classifyHumanBoundary } from "../playwright-worker/src/human-boundary.js";

assert.equal(classifyChallengeText("Welcome to the application"), null);
assert.equal(classifyChallengeText("Please verify you are human to continue")?.type, "captcha");
assert.equal(classifyChallengeText("Enter your two-factor authentication code")?.type, "two_factor");
assert.equal(classifyChallengeText("Security check: unusual activity detected")?.type, "security_challenge");
assert.equal(classifyChallengeText("Explore Security and Asset Protection careers"), null);
assert.equal(classifyChallengeText("Assistance programs for life’s challenges"), null);

assert.equal(
  classifyHumanBoundary({
    text: "Application",
    consentText: "Cookie privacy preferences. Accept all or manage preferences.",
  })?.type,
  "consent_required",
);
assert.equal(
  classifyHumanBoundary({
    text: "I consent to the background check and agree this information is correct.",
    consentText: "",
  }),
  null,
);

assert.equal(classifyHumanBoundary({ text: "Sign in with your password", url: "https://example.test/login", hasPasswordField: true })?.type, "login_required");
assert.equal(classifyHumanBoundary({ text: "Sign in", url: "https://example.test/login", hasPasswordField: false }), null);
assert.equal(
  classifyHumanBoundary({
    text: "Login | Walmart",
    url: "https://identity.walmart.com/account/login?client_id=test",
    hasPasswordField: false,
    hasCredentialIdentifierField: true,
  })?.type,
  "login_required",
);
assert.equal(
  classifyHumanBoundary({
    text: "Contact profile",
    url: "https://example.test/profile",
    hasPasswordField: false,
    hasCredentialIdentifierField: true,
  }),
  null,
);
assert.equal(classifyHumanBoundary({ text: "Profile password policy", url: "https://example.test/profile", hasPasswordField: false }), null);

assert.equal(
  classifyHumanBoundary({ text: "Application", alertDialogText: "Are you sure you want to continue?" })?.type,
  "unexpected_modal",
);
assert.equal(
  classifyHumanBoundary({ text: "Application", unsupportedControl: { semanticType: "unsupported", role: "slider" } })?.type,
  "unsupported_control",
);

const workerSource = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
for (const token of [
  "'NETWORK_HUMAN_ACTION_REQUIRED'",
  "requestedAction: boundary.requestedAction",
  "hasPasswordField: Boolean(document.querySelector('input[type=\"password\"]'))",
  "hasCredentialIdentifierField: Boolean(document.querySelector([",
  "consentText,",
  "alertDialogText,",
  "classifyHumanBoundary({",
  "assertSafeMutableField(field",
  "type: boundary?.type || 'unsupported_control'",
  "[role=\"slider\"]",
  "[role=\"spinbutton\"]",
  "resumeCondition:",
  "sendNetworkError(res, error, 'NETWORK_PAGE_CAPTURE_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_INSPECT_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_FORM_EXTRACT_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_CLICK_FAILED', correlation)",
  "sendNetworkError(res, error, 'NETWORK_REVIEW_CAPTURE_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_OPEN_FAILED')",
  "sendNetworkError(res, error, 'NETWORK_OPEN_JOB_FAILED')",
]) {
  assert.equal(workerSource.includes(token), true, `Human-boundary propagation invariant missing: ${token}`);
}

console.log("Network human-boundary regression passed.");
