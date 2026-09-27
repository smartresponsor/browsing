import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "? ['choose', 'choose-option']",
  "Array.from(queryRoot.querySelectorAll('input[type=\"radio\"][name=\"'",
  "const optionRoot = option.getRootNode();",
  "radioGroup: semanticType === 'radio' ? {",
  "selectedValue: options.find(option => option.selected)?.value ?? null",
  "selectedLabel: options.find(option => option.selected)?.label ?? null",
  "if (typeof value === 'string' && value.trim()) {",
  "Radio-group option was not found by exact value or label.",
  "String(option.value ?? '') === desired || String(option.label ?? '') === desired",
  "optionFrame.getByRole('radio', { name: accessibleName, exact: true })",
  "Radio-group option accessible name is ambiguous.",
  "Radio-group postcondition did not confirm the requested option.",
  "groupSelection: true",
  "optionMatch: 'exact-value-or-label-and-accessible-name'",
  "groupSelection: false",
]) {
  assert.equal(worker.includes(token), true, `Radio-group invariant missing: ${token}`);
}

console.log("Network radio-group regression passed.");

