import assert from 'node:assert/strict';
import { classifyVisibleFailure, failureEnvelope } from './failure-envelope.js';

for (const [reason, code] of [
  ['VISIBLE_BROWSER_WINDOW_NOT_DETECTED', 'WEB_VISIBLE_DESKTOP_MISSING'],
  ['WRONG_FOREGROUND_TARGET', 'WEB_FOREGROUND_TARGET_MISMATCH'],
  ['VISIBLE_SESSION_BUSY', 'WEB_VISIBLE_SESSION_BUSY'],
  ['WORKER_DRAINING', 'WEB_WORKER_DRAINING'],
  ['POLICY_DENIED', 'WEB_POLICY_DENIED'],
]) assert.equal(classifyVisibleFailure({ reason }), code);

const failure = failureEnvelope({ code: 'WEB_CDP_ATTACH_TIMEOUT', message: 'timeout', host: 'ubuntu', targetId: 'secret-target', evidence: { timeoutMs: 1000 } });
assert.equal(failure.failed_gate, 'cdp_attach');
assert.equal(failure.retryable, true);
assert.equal(failure.human_required, false);
assert.match(failure.session_target, /^sha256:[a-f0-9]{12}$/);
assert.equal(JSON.stringify(failure).includes('secret-target'), false);
console.log('Typed browser failure envelope regression passed.');
