import assert from "node:assert/strict";
import fs from "node:fs";

import { classifySubmitPostcondition } from "../playwright-worker/src/submit-postcondition.js";

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

const source = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
for (const token of [
  "classifySubmitPostcondition({ before, after, visibleText: postSubmitText })",
  "...postcondition",
  "Do not automatically repeat submit.",
]) {
  assert.equal(source.includes(token), true, `Submit postcondition integration invariant missing: ${token}`);
}

console.log("Web submit postcondition regression passed.");

