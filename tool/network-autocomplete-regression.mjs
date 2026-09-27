import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  '[aria-autocomplete], input[list]',
  "semanticType = 'autocomplete'",
  "autocompleteMode: semanticType === 'autocomplete' ? (tag === 'input' && node.list ? 'native-datalist' : 'aria') : null",
  "Array.from(node.list.options || []).slice(0, 500)",
  "['combobox', 'autocomplete'].includes(semanticType)",
  "if (semanticType === 'autocomplete') {",
  "field.autocompleteMode || await locator.evaluate",
  "Native datalist option was not found by exact value or label.",
  "option.value === desired || option.label === desired",
  "mode: 'native-datalist'",
  "optionMatch: 'exact-value-or-label'",
  "Autocomplete option was not found by exact accessible name.",
  "optionFrame.getByRole('option', { name: desired, exact: true })",
  "mode: 'aria'",
  "optionMatch: 'exact-accessible-name'",
]) {
  assert.equal(worker.includes(token), true, `Autocomplete invariant missing: ${token}`);
}

assert.equal(
  worker.includes("fuzzy"),
  false,
  "Autocomplete mutation must not introduce fuzzy matching.",
);

console.log("Network autocomplete regression passed.");

