import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  normalizeArtifactRef,
  resolveGuardedUploadArtifact,
} from "../playwright-worker/src/upload-artifact.js";
import { assertSafeUploadActivator, chooseUploadField, selectGuardedUploadFile } from "../playwright-worker/src/upload-control.js";

assert.throws(
  () => normalizeArtifactRef("C:\\Users\\example\\resume.pdf"),
  (error) => error?.webStatus === "WEB_UPLOAD_ARTIFACT_REF_INVALID",
);
assert.throws(
  () => normalizeArtifactRef("../resume.pdf"),
  (error) => error?.webStatus === "WEB_UPLOAD_ARTIFACT_REF_INVALID",
);
assert.equal(normalizeArtifactRef("candidate/resume.pdf"), path.join("candidate", "resume.pdf"));

const root = await mkdtemp(path.join(os.tmpdir(), "web-upload-"));
try {
  await mkdir(path.join(root, "candidate"), { recursive: true });
  const payload = Buffer.from("safe upload fixture\n", "utf8");
  const filePath = path.join(root, "candidate", "resume.pdf");
  await writeFile(filePath, payload);
  const sha256 = createHash("sha256").update(payload).digest("hex");

  const guarded = await resolveGuardedUploadArtifact({
    artifactRef: "candidate/resume.pdf",
    uploadRoot: root,
    expectedSha256: sha256,
    maxBytes: 1024 * 1024,
  });

  assert.equal(guarded.artifact.filename, "resume.pdf");
  assert.equal(guarded.artifact.size, payload.length);
  assert.equal(guarded.artifact.sha256, sha256);
  assert.equal(guarded.artifact.mime, "application/pdf");
  assert.equal(path.resolve(guarded.filePath), path.resolve(filePath));

  await assert.rejects(
    () => resolveGuardedUploadArtifact({
      artifactRef: "candidate/resume.pdf",
      uploadRoot: root,
      expectedSha256: "0".repeat(64),
    }),
    (error) => error?.webStatus === "WEB_UPLOAD_ARTIFACT_HASH_MISMATCH",
  );

  const blockedPath = path.join(root, "candidate", "script.exe");
  await writeFile(blockedPath, Buffer.from("blocked"));
  await assert.rejects(
    () => resolveGuardedUploadArtifact({
      artifactRef: "candidate/script.exe",
      uploadRoot: root,
    }),
    (error) => error?.webStatus === "WEB_UPLOAD_ARTIFACT_TYPE_BLOCKED",
  );

  const largePath = path.join(root, "candidate", "large.pdf");
  await writeFile(largePath, Buffer.alloc(2048, 1));
  await assert.rejects(
    () => resolveGuardedUploadArtifact({
      artifactRef: "candidate/large.pdf",
      uploadRoot: root,
      maxBytes: 1024,
    }),
    (error) => error?.webStatus === "WEB_UPLOAD_ARTIFACT_TOO_LARGE",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}


const fileControls = [
  { controlId: "iframe:resume", semanticType: "file", enabled: true, visible: false, framePath: [1] },
  { controlId: "cover-letter", semanticType: "file", enabled: false, visible: true, framePath: [] },
];
assert.equal(chooseUploadField(fileControls).controlId, "iframe:resume", "Unique enabled hidden input must be selectable");
assert.equal(chooseUploadField(fileControls, "iframe:resume").framePath[0], 1, "Iframe identity must be preserved");
assert.throws(() => chooseUploadField(fileControls, "stale"), error => error?.webStatus === "WEB_FIELD_NOT_FOUND");
assert.throws(() => chooseUploadField(fileControls, "cover-letter"), error => error?.webStatus === "WEB_CONTROL_UNSUPPORTED");
assert.throws(() => chooseUploadField([
  ...fileControls,
  { controlId: "another", semanticType: "file", enabled: true, visible: false },
]), error => error?.webStatus === "WEB_FIELD_AMBIGUOUS");
assert.throws(() => chooseUploadField([{ controlId: "name", semanticType: "text", enabled: true }]),
  error => error?.webStatus === "WEB_UPLOAD_CONTROL_REQUIRED");
assert.throws(() => chooseUploadField(fileControls, "name"),
  error => error?.webStatus === "WEB_FIELD_NOT_FOUND");

const uploadFixture = {
  filePath: "mock://artifact/candidate/resume.pdf",
  artifact: { filename: "resume.pdf", size: 1024 },
};
function mockUploadInput({ type = "file", enabled = true, detachOnUpload = false, persistFiles = true } = {}) {
  let dispatched = 0;
  let detached = false;
  // The mock has no visibility API: upload must never require isVisible().
  const node = {
    tagName: "INPUT",
    disabled: !enabled,
    getAttribute(name) { return name === "type" ? type : null; },
    files: []
  };
  const locator = {
    async evaluate(fn) {
      if (detached) throw new Error("DOM input was replaced by the framework");
      return fn(node);
    },
    async setInputFiles(value) {
      assert.equal(value, uploadFixture.filePath);
      dispatched++;
      if (detachOnUpload) detached = true;
      if (persistFiles) node.files = [{ name: "resume.pdf", size: 1024, type: "application/pdf" }];
    },
  };
  return { locator, get dispatched() { return dispatched; } };
}

const hidden = mockUploadInput();
const uploaded = await selectGuardedUploadFile({ locator: hidden.locator, artifact: uploadFixture });
assert.equal(hidden.dispatched, 1);
assert.equal(uploaded.status, "WEB_UPLOAD_INPUT_VERIFIED");
assert.equal(uploaded.selectionVerified, true);
assert.equal(uploaded.serverAcceptanceVerified, false);
assert.equal(uploaded.uploaded.filename, "resume.pdf");

const detached = mockUploadInput({ detachOnUpload: true });
await assert.rejects(
  () => selectGuardedUploadFile({ locator: detached.locator, artifact: uploadFixture, sleep: async () => {} }),
  error => error?.webStatus === "WEB_UPLOAD_POSTCONDITION_UNVERIFIED"
    && error?.evidence?.automaticRetryAllowed === false
    && error?.evidence?.externalActionMayHaveOccurred === true,
);
assert.equal(detached.dispatched, 1, "Uncertain upload must never repeat setInputFiles");
const missingPostcondition = mockUploadInput({ persistFiles: false });
await assert.rejects(
  () => selectGuardedUploadFile({ locator: missingPostcondition.locator, artifact: uploadFixture, sleep: async () => {} }),
  error => error?.webStatus === "WEB_UPLOAD_POSTCONDITION_UNVERIFIED"
);
assert.equal(missingPostcondition.dispatched, 1);
for (const attributes of [{ type: "text" }, { enabled: false }]) {
  const rejected = mockUploadInput(attributes);
  await assert.rejects(
    () => selectGuardedUploadFile({ locator: rejected.locator, artifact: uploadFixture }),
    error => error?.webStatus === "WEB_CONTROL_UNSUPPORTED"
  );
  assert.equal(rejected.dispatched, 0, "Invalid or disabled input may not receive files");
}

const dispatchUnknown = mockUploadInput();
dispatchUnknown.locator.setInputFiles = async () => { throw new Error("Playwright lost the CDP reply"); };
await assert.rejects(
  () => selectGuardedUploadFile({ locator: dispatchUnknown.locator, artifact: uploadFixture }),
  error => error?.webStatus === "WEB_UPLOAD_DISPATCH_UNVERIFIED"
    && error?.evidence?.automaticRetryAllowed === false
);

const workerSource = (await import("node:fs")).readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
for (const token of ["chooseUploadField(fields, controlId)", "selectGuardedUploadFile({", "selectionVerified: selection.selectionVerified", "serverAcceptanceVerified: selection.serverAcceptanceVerified"]) {
  assert.ok(workerSource.includes(token), `Worker integration invariant missing: ${token}`);
}

for (const safe of [
  { tag: "button", label: "Upload Resume", visible: true, enabled: true },
  { tag: "label", label: "Browse Files", visible: true, enabled: true },
  { tag: "div", marker: "dropzone", label: "Drop Files Here", visible: true, enabled: true },
  { tag: "div", role: "button", label: "Attach CV", visible: true, enabled: true }
]) {
  assert.ok(assertSafeUploadActivator(safe).label, "Recognized upload activator must be allowed");
}
assert.ok(assertSafeUploadActivator({tag:'li',role:'menuitem',label:'My computer',visible:true,enabled:true},{allowLocalComputerMenuItem:true}).label);
assert.throws(() => assertSafeUploadActivator({tag:'li',role:'menuitem',label:'My computer',visible:true,enabled:true}), e => e?.webStatus === 'WEB_UPLOAD_TRIGGER_UNSAFE');
for (const unsafe of [
  { tag: "button", label: "Submit Application", visible: true, enabled: true },
  { tag: "button", label: "Upload CV and Submit", visible: true, enabled: true },
  { tag: "button", type: "submit", label: "Upload Resume", visible: true, enabled: true },
  { tag: "button", type: "reset", label: "Browse Files", visible: true, enabled: true },
  { tag: "a", role: "button", label: "Upload CV", visible: true, enabled: true },
  { tag: "a", label: "Upload Resume", visible: true, enabled: true },
  { tag: "button", label: "Browse Files", visible: false, enabled: true },
  { tag: "button", label: "Attach CV", visible: true, enabled: false },
  { tag: "div", label: "Drop Files Here", visible: true, enabled: true },
  { tag: "button", label: "Continue", visible: true, enabled: true }
]) {
  assert.throws(() => assertSafeUploadActivator(unsafe),
    error => error?.webStatus === "WEB_UPLOAD_TRIGGER_UNSAFE");
}
const chooserInput = mockUploadInput();
let chooserCalls = 0;
const browserInputDispatch = chooserInput.locator.setInputFiles;
const chooserResult = await selectGuardedUploadFile({
  locator: chooserInput.locator,
  artifact: uploadFixture,
  performSelection: async filePath => { chooserCalls++; await browserInputDispatch(filePath); }
});
assert.equal(chooserCalls, 1);
assert.equal(chooserInput.dispatched, 1);
assert.equal(chooserResult.selectionVerified, true);
assert.equal(chooserResult.serverAcceptanceVerified, false);
for (const invariant of [
  "assertSafeUploadActivator(field, { allowLocalComputerMenuItem: googleResumeMenuVisible })",
  "target.waitForEvent('filechooser'",
  "performSelection: filePath => chooser.setFiles(filePath)",
  "selectionMechanism: resolvedControl.mode === 'filechooser'",
  "WEB_UPLOAD_CHOOSER_UNVERIFIED"
]) {
  assert.ok(workerSource.includes(invariant), `Safe dropzone/filechooser invariant missing: ${invariant}`);
}

console.log("Web guarded upload artifact regression passed.");

