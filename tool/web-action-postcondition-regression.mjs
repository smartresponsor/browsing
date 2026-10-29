import assert from 'node:assert/strict';
import { validateExpectedOutcome, identityFailure } from '../playwright-worker/src/action-postcondition.js';
import { classifySubmitPostcondition, settleSubmitPostcondition } from '../playwright-worker/src/submit-postcondition.js';
import { settleClickTransition } from '../playwright-worker/src/click-transition-settle.js';
import { createWebCoreDomainToolDefinitions } from '../mcp-server/src/web-domain-tool-definitions.js';

const before = { targetId: 'target', targetIdentityVerified: true, browserSessionId: 'session',
  url: 'https://example.test/event/apply', pageRevision: 'before', formRevision: 'form',
  visibleText: 'Apply', expectedObservation: { count: 0, visible: false, text: null } };
const expectedOutcome = { url: 'https://example.test/event',
  element: { selector: '[data-testid="registered-state"]', text: 'Waitlisted' } };
const after = { ...before, url: expectedOutcome.url, pageRevision: 'after',
  expectedObservation: { count: 1, visible: true, text: 'Waitlisted' } };
const classify = (a, b = before) => classifySubmitPostcondition({
  before: b, after: a, visibleText: 'Waitlisted', expectedOutcome });
assert.equal(classify(after).verified, true, 'Incident B: explicit registration state');
assert.equal(classify({ ...after, expectedObservation: null }).verified, false, 'navigation alone is insufficient');
assert.equal(classify({ ...after, expectedObservation: { ...after.expectedObservation, visible: false } }).verified, false);
assert.equal(classify({ ...after, expectedObservation: { ...after.expectedObservation, count: 2 } }).verified, false);
assert.equal(classify(after, { ...before, expectedObservation: after.expectedObservation }).verified, false,
  'a pre-existing badge cannot establish success');
assert.equal(classify({ ...after, url: before.url }).verified, false, 'all predicates must match');
assert.equal(classifySubmitPostcondition({ before, after, visibleText: 'Waitlisted' }).verified, false,
  'Waitlisted is not a global success keyword');

const submitSchema = createWebCoreDomainToolDefinitions().find(t => t.consoleName === 'write.web.form.submit').inputSchema;
for (const invalid of [{ url: expectedOutcome.url }, { element: { selector: '', text: 'ok' } },
  { ...expectedOutcome, url: 'javascript:alert(1)' }, { ...expectedOutcome, unknown: true },
  { element: { selector: 'x'.repeat(501), text: 'ok' } }]) {
  assert.throws(() => validateExpectedOutcome(invalid));
  assert.equal(submitSchema.safeParse({ approved: true, approvalText: 'SUBMIT', expectedOutcome: invalid }).success, false);
}
assert.deepEqual(validateExpectedOutcome(expectedOutcome), expectedOutcome);
const definition = createWebCoreDomainToolDefinitions().find(t => t.consoleName === 'write.web.form.submit');
const payload = definition.toPayload({ approved: true, approvalText: 'SUBMIT', expectedOutcome });
assert.deepEqual(payload.expectedOutcome, expectedOutcome, 'schema bridge preserves contract');
let reads = 0;
const delayed = await settleSubmitPostcondition({ before, expectedOutcome, maxAttempts: 4, sleep: async () => {},
  readSnapshot: async () => ({ after: ++reads === 3 ? after : before, visibleText: 'Waitlisted' }) });
assert.equal(delayed.verified, true);
assert.equal(reads, 3);
assert.equal(delayed.observations.length, 3);
assert.equal(delayed.retrySafe, false);
assert.equal(delayed.externalActionMayHaveOccurred, true);
for (const changed of [{ ...after, targetId: 'unexpected' }, { ...after, browserSessionId: 'other' },
  { ...after, targetIdentityVerified: false }, { ...after, targetId: 'fallback:invented' }]) {
  assert.ok(identityFailure(before, changed));
  let attempts = 0;
  const result = await settleSubmitPostcondition({ before, expectedOutcome, maxAttempts: 3,
    readSnapshot: async () => { attempts++; return { after: changed, visibleText: 'Successfully submitted' }; } });
  assert.equal(result.verified, false);
  assert.equal(result.retrySafe, false);
  assert.equal(attempts, 1, 'identity failure cannot recover to success on another target');
  const click = await settleClickTransition({ before, initialAfter: changed, capture: async () => after });
  assert.ok(click.identityError);
  assert.deepEqual(click.transition, {});
}
const controlBefore = { ...before, controlState: { ariaChecked: 'false' } };
const controlAfter = { ...controlBefore, controlState: { ariaChecked: 'true' } };
const toggled = await settleClickTransition({ before: controlBefore, initialAfter: controlAfter });
assert.equal(toggled.transition.controlStateChanged, true, 'Incident A: accessible state transition');
const noOp = await settleClickTransition({ before: controlBefore, initialAfter: controlBefore, timeoutMs: 0 });
assert.equal(noOp.transition.controlStateChanged, false, 'no-op remains unresolved');
const mutation = await settleClickTransition({ before, initialAfter: { ...before, pageRevision: 'animation' }, timeoutMs: 0 });
assert.equal(mutation.settled, false, 'generic page mutation is not action success');
const finalReadFails = await settleSubmitPostcondition({ before, maxAttempts: 2, sleep: async () => {},
  readSnapshot: async () => { if (++reads > 4) throw new Error('lost'); return { after: before, visibleText: 'Please correct the errors' }; } });
assert.equal(finalReadFails.status, 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED', 'do not reuse stale rejection');
const timeout = await settleSubmitPostcondition({ before, expectedOutcome, timeoutMs: 10,
  readSnapshot: () => new Promise(() => {}) });
assert.equal(timeout.verified, false);
assert.equal(timeout.retrySafe, false);
console.log('Action postconditions: explicit outcome, schema, identity, ARIA and ambiguity passed.');
