import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "const SEMANTIC_FIELD_SELECTOR = 'input, textarea, select, [contenteditable=\"true\"], [role=\"combobox\"], [role=\"switch\"], [aria-autocomplete], input[list]';",
  "semanticType = 'checkbox'",
  "semanticType = 'radio'",
  "semanticType = 'file'",
  "semanticType = 'combobox'",
  "semanticType = 'autocomplete'",
  "semanticType = 'contenteditable'",
  "supportedOperations",
  "validation: validity",
  "semanticModelVersion: 3",
  "controlId:",
  "hashStableJson({ fingerprint, occurrence })",
  "const controlId = getRequestedControlId(item);",
  "fields.find(candidate => candidate.controlId === controlId)",
  "await locator.selectOption(desired)",
  "await locator.check()",
  "await locator.uncheck()",
  "semanticType === 'contenteditable'",
  "semanticType === 'combobox'",
  "optionFrame.getByRole('option', { name: desired, exact: true })",
  "optionCount === 0 ? 'NETWORK_FIELD_NOT_FOUND' : 'NETWORK_FIELD_AMBIGUOUS'",
  "optionMatch: 'exact-accessible-name'",
  "NETWORK_VALIDATION_FAILED",
  "NETWORK_CONTROL_UNSUPPORTED",
  "return { locator: await locatorForFieldSnapshot(target, field), field };",
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

