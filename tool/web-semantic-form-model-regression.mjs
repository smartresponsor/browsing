import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "const SEMANTIC_FIELD_SELECTOR = 'input, textarea, select, [contenteditable=\"true\"], [role=\"combobox\"], [role=\"switch\"], [aria-autocomplete], input[list], [role=\"slider\"], [role=\"spinbutton\"]';",
  "semanticType = 'checkbox'",
  "!['checkbox', 'radio', 'contenteditable', 'combobox', 'autocomplete', 'switch'].includes(semanticType)",
  "semanticType = 'radio'",
  "radioGroup: semanticType === 'radio' ? {",
  "semanticType = 'file'",
  "semanticType = 'combobox'",
  "semanticType = 'autocomplete'",
  "semanticType = 'contenteditable'",
  "supportedOperations",
  "validation: validity",
  "semanticModelVersion: 4",
  "controlId:",
  "shadowPath: field.shadowPath",
  "shadowDepth: shadowPath.length",
  "hashStableJson({ fingerprint, occurrence })",
  "const controlId = getRequestedControlId(item);",
  "fields.find(candidate => candidate.controlId === controlId)",
  "await locator.selectOption(desired)",
  "selected.value !== desired && selected.label !== desired",
  "actualLabel: selected.label",
  "await locator.check()",
  "await locator.uncheck()",
  "semanticType === 'contenteditable'",
  "semanticType === 'combobox'",
  "optionFrame.getByRole('option', { name: desired, exact: true })",
  "optionCount === 0 ? 'WEB_FIELD_NOT_FOUND' : 'WEB_FIELD_AMBIGUOUS'",
  "optionMatch: 'exact-accessible-name'",
  "WEB_VALIDATION_FAILED",
  "WEB_CONTROL_UNSUPPORTED",
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

// Composite month/year widgets must not fall through to a single fill() event.
for (const token of [
  "const dateSegment = await locator.evaluate(node => {",
  "dateSection|date[-_ ]?segment",
  "await locator.pressSequentially(desired, { delay: 35 });",
  "await locator.press('Tab');",
  "verifiedAfterBlur: true",
  "Invalid composite date segment.",
]) {
  assert.equal(source.includes(token), true, `Composite date regression invariant missing: ${token}`);
}

// Execute the worker's actual writeField function against a controlled mock input.
// This checks mutation sequencing, not merely the presence of source tokens.
const { runInNewContext } = await import('node:vm');
const functionStart = source.indexOf('async function writeField(');
const functionEnd = source.indexOf('\nfunction normalizeBooleanMutationValue(', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart);
const writeField = runInNewContext(
  source.slice(functionStart, functionEnd) + '\nwriteField',
  {
    revisionError: (status, message, details) =>
      Object.assign(new Error(message), { status, details }),
  },
);
function controlledLocator(automationId, { maskYear = false } = {}) {
  const state = { value: '', eventLog: [], dateSection: automationId };
  const node = {
    tagName: 'INPUT',
    getAttribute: name => name === 'data-automation-id' ? automationId : '',
  };
  const locator = {
    evaluate: async fn => fn(node),
    click: async () => state.eventLog.push('click'),
    press: async key => state.eventLog.push(key),
    pressSequentially: async value => {
      state.value = maskYear ? value.slice(0, 2) : value;
      state.eventLog.push('type:' + value);
    },
    fill: async value => { state.value = value; state.eventLog.push('fill:' + value); },
    inputValue: async () => state.value,
  };
  return { locator, state };
}
{
  const { locator, state } = controlledLocator('dateSectionMonth-input');
  const result = await writeField({}, locator, '06', { semanticType: 'text' });
  assert.equal(result.dateSegment, 'month');
  assert.equal(result.verifiedAfterBlur, true);
  assert.deepEqual(state.eventLog, ['click', 'ControlOrMeta+A', 'type:06', 'Tab']);
}
{
  const { locator, state } = controlledLocator('dateSectionYear-input');
  const result = await writeField({}, locator, '2025', { semanticType: 'text' });
  assert.equal(result.dateSegment, 'year');
  assert.equal(state.value, '2025');
}
{
  const { locator, state } = controlledLocator('ordinaryText');
  const result = await writeField({}, locator, 'Hello', { semanticType: 'text' });
  assert.equal(result.actual, 'Hello');
  assert.deepEqual(state.eventLog, ['fill:Hello']);
}
{
  const { locator } = controlledLocator('dateSectionMonth-input');
  await assert.rejects(
    writeField({}, locator, '13', { semanticType: 'text' }),
    error => error.status === 'WEB_VALIDATION_FAILED',
  );
}
{
  const { locator } = controlledLocator('dateSectionYear-input', { maskYear: true });
  await assert.rejects(
    writeField({}, locator, '2025', { semanticType: 'text' }),
    error => error.status === 'WEB_VALIDATION_FAILED' && error.details.actual === '20',
  );
}
console.log("Web semantic form model regression passed.");

