import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { assertActionIdentity, validateExpectedOutcome, writeActionEvidence } from '../playwright-worker/src/action-postcondition.js';
import { settleSubmitPostcondition } from '../playwright-worker/src/submit-postcondition.js';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const source = readFileSync(new URL('../playwright-worker/src/worker.js', import.meta.url), 'utf8');
const start = source.indexOf("app.post('/submit-after-approval'");
const end = source.indexOf('\nasync function listManagedBrowserProcesses', start);
const errorStart = source.indexOf('function sendActionError(');
const errorEnd = source.indexOf('\nfunction sendWebError(', errorStart);
const before = { targetId: 'target', targetIdentityVerified: true, browserSessionId: 'session',
  url: 'https://example.test/apply', reviewHash: 'review', visibleText: 'Apply' };
for (const mode of ['success', 'click-error', 'precondition-error']) {
  let clicks = 0, receipts = 0, reads = 0, handler, response;
  const locator = { count: async () => 1, nth() { return this; },
    click: async () => { clicks++; if (mode === 'click-error') throw new Error('navigation failed after click'); } };
  const target = { locator: () => locator, waitForLoadState: async () => {} };
  const context = {
    app: { post: (_route, fn) => { handler = fn; } },
    normalizeExecutionCorrelation: () => ({ invocationId: 'fixture' }),
    validateExpectedOutcome, assertActionIdentity,
    getPolicy: () => ({ requireApprovalForSubmit: true, requireApprovalReceiptForSubmit: true }),
    ensurePage: async () => target, ensureNotChallenge: async () => {},
    captureActionArtifact: async () => {
      reads++;
      if (!clicks) return { ...before, targetIdentityVerified: mode !== 'precondition-error' };
      return { ...before, url: 'https://example.test/event',
        expectedObservation: { count: 1, visible: true, text: reads >= 4 ? 'Waitlisted' : 'Submitting' } };
    },
    assertExpectedRevisions: () => {}, expectedRevisionsFromBody: () => ({}),
    approvalPayloadHash: () => 'payload', hashStableJson: () => 'hash',
    consumeApprovalReceipt: async () => { receipts++; return { id: 'one-time' }; },
    settleSubmitPostcondition: args => settleSubmitPostcondition({ ...args, sleep: async () => {} }),
    normalizeError: error => error.message
  };
  runInNewContext(source.slice(errorStart, errorEnd) + '\n' + source.slice(start, end), context);
  await handler({ body: { approved: true, approvalText: 'SUBMIT', selector: '#submit',
    expectedOutcome: { element: { selector: '#status', text: 'Waitlisted' } } } },
    { status() { return this; }, json(value) { response = value; } });
  assert.equal(clicks, mode === 'precondition-error' ? 0 : 1);
  assert.equal(receipts, mode === 'precondition-error' ? 0 : 1);
  assert.equal(response.verified, mode === 'success');
  assert.equal(response.externalActionMayHaveOccurred, mode !== 'precondition-error');
  assert.equal(response.retrySafe, mode === 'precondition-error');
  if (mode === 'success') assert.equal(reads, 4, 'multiple reads, one real route click and one receipt');
}
const directory = await mkdtemp(path.join(tmpdir(), 'browser-action-evidence-'));
try {
  const artifact = await writeActionEvidence('/submit-after-approval', {
    status: 'WEB_SUBMIT_VERIFIED', verified: true, outcome: 'success',
    before: { ...before, fields: [{ value: 'PRIVATE FORM CONTENT' }] },
    after: before, correlation: { invocationId: 'test' }
  }, directory);
  const text = await readFile(artifact, 'utf8');
  assert.equal(JSON.parse(text).before.targetId, before.targetId);
  assert.equal(text.includes('PRIVATE FORM CONTENT'), false);
  if (process.platform !== 'win32') assert.equal((await stat(artifact)).mode & 0o777, 0o600);
} finally { await rm(directory, { recursive: true, force: true }); }
console.log('Actual submit route: one click/receipt, delayed reads, pre/post errors and private evidence passed.');
