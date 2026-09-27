import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "const SEMANTIC_FIELD_SELECTOR = 'input, textarea, select, [contenteditable=\"true\"], [role=\"combobox\"]';",
  "semanticType = 'checkbox'",
  "semanticType = 'radio'",
  "semanticType = 'file'",
  "semanticType = 'combobox'",
  "semanticType = 'contenteditable'",
  "supportedOperations",
  "validation: validity",
  "semanticModelVersion: 2",
  "controlId:",
  "hashStableJson({ fingerprint, occurrence })",
  "const controlId = getRequestedControlId(item);",
  "fields.find(candidate => candidate.controlId === controlId)",
  "return target.locator(SEMANTIC_FIELD_SELECTOR).nth(field.index);",
]) {
  assert.equal(source.includes(token), true, `Semantic Form Model v2 invariant missing: ${token}`);
}

const controlIdBranch = source.indexOf("const controlId = getRequestedControlId(item);");
const legacyIndexBranch = source.indexOf("const index = getRequestedFieldIndex(item);", controlIdBranch);
assert.ok(controlIdBranch >= 0 && legacyIndexBranch > controlIdBranch, "controlId must be resolved before legacy field index");

assert.equal(
  source.includes("File control requires the guarded upload capability"),
  true,
  "file controls must be modeled semantically but remain blocked from generic fill",
);

console.log("Network semantic form model regression passed.");

