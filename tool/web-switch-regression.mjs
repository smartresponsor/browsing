import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  '[role="switch"]',
  "semanticType = 'switch'",
  "['switch-on', 'switch-off']",
  "node.getAttribute('aria-checked') === 'true'",
  "['checkbox', 'radio', 'contenteditable', 'combobox', 'autocomplete', 'switch']",
  "if (semanticType === 'switch') {",
  "const before = await locator.getAttribute('aria-checked') === 'true';",
  "await locator.click();",
  "Switch postcondition did not match the requested state.",
  "return { semanticType: 'switch', requested: desired, actual };",
]) {
  assert.equal(worker.includes(token), true, `ARIA switch invariant missing: ${token}`);
}

console.log("Web ARIA switch regression passed.");

