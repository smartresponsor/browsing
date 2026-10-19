import assert from "node:assert/strict";
import {
  assertExpectedRevisions,
  buildRevisionEnvelope,
} from "../playwright-worker/src/revision-contract.js";

const base = buildRevisionEnvelope({
  targetId: "target-1",
  url: "https://example.test/form",
  title: "Form",
  textHash: "text-a",
  fields: [{ name: "email", value: "" }],
});

assert.equal(base.targetId, "target-1");
assert.equal(base.formRevision, base.formHash);
assert.equal(typeof base.pageRevision, "string");
assert.equal(base.pageRevision.length, 64);

assert.equal(
  assertExpectedRevisions({
    targetId: base.targetId,
    pageRevision: base.pageRevision,
    formRevision: base.formRevision,
  }, base),
  true,
);

const pageOnlyDrift = {
  ...base,
  pageRevision: "dynamic-page-drift",
};
assert.equal(
  assertExpectedRevisions({
    targetId: base.targetId,
    pageRevision: base.pageRevision,
    formRevision: base.formRevision,
  }, pageOnlyDrift, { allowPageRevisionDriftWhenFormStable: true }),
  true,
);

for (const [expected, status] of [
  [{ targetId: "target-2" }, "WEB_TARGET_STALE"],
  [{ pageRevision: "stale-page" }, "WEB_PAGE_REVISION_STALE"],
  [{ formRevision: "stale-form" }, "WEB_FORM_REVISION_STALE"],
]) {
  assert.throws(
    () => assertExpectedRevisions(expected, base),
    (error) => error?.webStatus === status && typeof error?.evidence === "object",
    `expected stale revision status ${status}`,
  );
}

const changedForm = buildRevisionEnvelope({
  targetId: "target-1",
  url: "https://example.test/form",
  title: "Form",
  textHash: "text-a",
  fields: [{ name: "email", value: "changed@example.test" }],
});

assert.notEqual(changedForm.formRevision, base.formRevision);
assert.notEqual(changedForm.pageRevision, base.pageRevision);

console.log("Web revision contract regression passed.");

