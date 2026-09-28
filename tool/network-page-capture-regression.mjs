import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyFinalActionCandidate } from "../playwright-worker/src/final-action-classifier.js";

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "import { createHash } from 'node:crypto';",
  "return createHash('sha256').update(String(text || '').replace(/\\r\\n/g, '\\n').trim(), 'utf8').digest('hex');",
  "app.post('/page-capture'",
  "capturePageArtifact(target, { screenshot: req.body?.screenshot === true })",
]) {
  assert.equal(worker.includes(token), true, `Page capture hashing invariant missing: ${token}`);
}

for (const text of ["Apply", "Apply now", "Apply to 1 role", "Apply manually", "Start application", "Continue application"]) {
  assert.equal(
    classifyFinalActionCandidate({ text, type: "button" }),
    false,
    `${text} must remain a workflow-entry candidate rather than a final-submit candidate`,
  );
}

for (const text of ["Submit application", "Complete application", "Finish application", "Withdraw application", "Confirm submission"]) {
  assert.equal(
    classifyFinalActionCandidate({ text, type: "button" }),
    true,
    `${text} must remain a final/destructive action candidate`,
  );
}

assert.equal(classifyFinalActionCandidate({ text: "Continue", type: "submit" }), true, "native submit controls remain conservatively final candidates");

console.log("Network page capture hashing regression passed.");

