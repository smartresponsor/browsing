import assert from "node:assert/strict";
import fs from "node:fs";

import { classifySubmitPostcondition, settleSubmitPostcondition } from "../playwright-worker/src/submit-postcondition.js";

const before = {
  url: "https://example.test/apply",
  pageRevision: "before-revision",
};

const verified = classifySubmitPostcondition({
  before,
  after: {
    url: "https://example.test/confirmation",
    pageRevision: "after-revision",
  },
  visibleText: "Thank you for your application. Your submission has been received.",
});
assert.equal(verified.ok, true);
assert.equal(verified.status, "WEB_SUBMIT_VERIFIED");
assert.equal(verified.verified, true);
assert.equal(verified.retrySafe, false);
assert.equal(verified.evidence.kind, "confirmation-text");

const validation = classifySubmitPostcondition({
  before,
  after: before,
  visibleText: "Please correct the errors below. This field is required.",
});
assert.equal(validation.ok, false);
assert.equal(validation.status, "WEB_SUBMIT_VALIDATION_FAILED");
assert.equal(validation.verified, false);
assert.equal(validation.retrySafe, false);

const conflicting = classifySubmitPostcondition({
  before,
  after: {
    url: "https://example.test/confirmation",
    pageRevision: "after-revision",
  },
  visibleText: "Thank you for your application. Please correct the errors below. This field is required.",
});
assert.equal(conflicting.ok, false);
assert.equal(conflicting.status, "WEB_SUBMIT_VALIDATION_FAILED");
assert.equal(conflicting.verified, false);
assert.equal(conflicting.retrySafe, false);

const unverified = classifySubmitPostcondition({
  before,
  after: {
    url: "https://example.test/next-step",
    pageRevision: "after-revision",
  },
  visibleText: "Continue",
});
assert.equal(unverified.ok, false);
assert.equal(unverified.status, "WEB_SUBMIT_POSTCONDITION_UNVERIFIED");
assert.equal(unverified.verified, false);
assert.equal(unverified.retrySafe, false);
assert.equal(unverified.externalActionMayHaveOccurred, true);
assert.equal(unverified.evidence.urlChanged, true);

let observations = 0;
let sleeps = 0;
const delayed = await settleSubmitPostcondition({
  before,
  readSnapshot: async () => {
    observations++;
    return {
      after: { url: observations === 3 ? 'https://example.test/confirmation' : before.url, pageRevision: String(observations) },
      visibleText: observations === 3 ? 'Your application has been received.' : 'Submitting...'
    };
  },
  sleep: async () => { sleeps++; },
  maxAttempts: 5
});
assert.equal(delayed.status, 'WEB_SUBMIT_VERIFIED');
assert.equal(delayed.verified, true);
assert.equal(delayed.observationAttempts, 3);
assert.equal(observations, 3);
assert.equal(sleeps, 2);

const uncertain = await settleSubmitPostcondition({
  before, maxAttempts: 3, sleep: async () => {},
  readSnapshot: async () => ({ after: before, visibleText: 'Please wait' })
});
assert.equal(uncertain.status, 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED');
assert.equal(uncertain.retrySafe, false);
assert.equal(uncertain.externalActionMayHaveOccurred, true);
assert.equal(uncertain.observationAttempts, 3);

let calls = 0;
const validationSettled = await settleSubmitPostcondition({
  before,
  readSnapshot: async () => { calls++; return { after: before, visibleText: 'Please correct the errors below.' }; },
  sleep: async () => { throw new Error('Should not delay after validation failure'); }
});
assert.equal(validationSettled.status, 'WEB_SUBMIT_VALIDATION_FAILED');
assert.equal(calls, 1);

const failedObservations = await settleSubmitPostcondition({
  before, maxAttempts: 2, sleep: async () => {},
  readSnapshot: async () => { throw new Error('CDP temporarily unavailable'); }
});
assert.equal(failedObservations.status, 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED');
assert.equal(failedObservations.retrySafe, false);
assert.equal(failedObservations.evidence.kind, 'observation-unavailable');

const source = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
for (const token of [
  "settleSubmitPostcondition({",
  "const after = postcondition.after ?? null;",
  "...postcondition",
  "Do not automatically repeat submit.",
]) {
  assert.equal(source.includes(token), true, `Submit postcondition integration invariant missing: ${token}`);
}

console.log("Web submit postcondition regression passed.");

