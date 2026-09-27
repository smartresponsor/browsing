import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  normalizeArtifactRef,
  resolveGuardedUploadArtifact,
} from "../playwright-worker/src/upload-artifact.js";

assert.throws(
  () => normalizeArtifactRef("C:\\Users\\example\\resume.pdf"),
  (error) => error?.networkStatus === "NETWORK_UPLOAD_ARTIFACT_REF_INVALID",
);
assert.throws(
  () => normalizeArtifactRef("../resume.pdf"),
  (error) => error?.networkStatus === "NETWORK_UPLOAD_ARTIFACT_REF_INVALID",
);
assert.equal(normalizeArtifactRef("candidate/resume.pdf"), path.join("candidate", "resume.pdf"));

const root = await mkdtemp(path.join(os.tmpdir(), "network-upload-"));
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
    (error) => error?.networkStatus === "NETWORK_UPLOAD_ARTIFACT_HASH_MISMATCH",
  );

  const blockedPath = path.join(root, "candidate", "script.exe");
  await writeFile(blockedPath, Buffer.from("blocked"));
  await assert.rejects(
    () => resolveGuardedUploadArtifact({
      artifactRef: "candidate/script.exe",
      uploadRoot: root,
    }),
    (error) => error?.networkStatus === "NETWORK_UPLOAD_ARTIFACT_TYPE_BLOCKED",
  );

  const largePath = path.join(root, "candidate", "large.pdf");
  await writeFile(largePath, Buffer.alloc(2048, 1));
  await assert.rejects(
    () => resolveGuardedUploadArtifact({
      artifactRef: "candidate/large.pdf",
      uploadRoot: root,
      maxBytes: 1024,
    }),
    (error) => error?.networkStatus === "NETWORK_UPLOAD_ARTIFACT_TOO_LARGE",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Network guarded upload artifact regression passed.");

