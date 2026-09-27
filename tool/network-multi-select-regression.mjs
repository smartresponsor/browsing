import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "node.multiple ? ['select-multiple'] : ['select']",
  "const multiple = field.multiple === true || await locator.evaluate(node => Boolean(node.multiple));",
  "Multi-select mutation requires an array of option values.",
  "await locator.selectOption(desired);",
  "Array.from(node.selectedOptions || []).map(option => String(option.value ?? ''))",
  "Multi-select postcondition did not match the requested option set.",
  "return { semanticType: 'select', multiple: true, requested: desired, actual };",
]) {
  assert.equal(worker.includes(token), true, `Multi-select invariant missing: ${token}`);
}

console.log("Network native multi-select regression passed.");

