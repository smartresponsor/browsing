import { createHash } from 'node:crypto';

const GATES = Object.freeze({
  WEB_AUTH_ACTION_REQUIRED: ['auth', true, false, 'Complete login in the authorized visible browser, then retry.'],
  WEB_MFA_ACTION_REQUIRED: ['mfa', true, false, 'Complete MFA in the authorized visible browser, then retry.'],
  WEB_CAPTCHA_ACTION_REQUIRED: ['captcha', true, false, 'Complete CAPTCHA manually; automation must not bypass it.'],
  WEB_COOKIE_ACTION_REQUIRED: ['browser_prompt', true, false, 'Resolve the visible consent prompt, then retry.'],
  WEB_VISIBLE_DESKTOP_MISSING: ['visible_desktop', true, true, 'Restore the interactive desktop session and re-run readiness.'],
  WEB_FOREGROUND_TARGET_MISMATCH: ['foreground_target', true, true, 'Focus the exact authorized target and retry with its target id.'],
  WEB_VISIBLE_SESSION_BUSY: ['worker_ownership', false, true, 'Wait for the owning operation to finish or perform authenticated drain.'],
  WEB_WORKER_DRAINING: ['worker_drain', false, true, 'Wait for drain completion or authenticated resume.'],
  WEB_CDP_ATTACH_TIMEOUT: ['cdp_attach', false, true, 'Recycle only the managed attachment worker; preserve the Edge session.'],
  WEB_POLICY_DENIED: ['policy', false, false, 'Use an allowed host/action or obtain an explicit policy change.'],
});

function sanitizeIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return `sha256:${createHash('sha256').update(raw).digest('hex').slice(0, 12)}`;
}

export function failureEnvelope({ code, message, subsystem = 'browser', host, targetId, evidence = {} }) {
  const [failedGate, humanRequired, retryable, remedy] = GATES[code] || ['operation', false, false, 'Inspect observed evidence before retrying.'];
  return {
    ok: false,
    code,
    status: code,
    failed_gate: failedGate,
    subsystem,
    host: String(host || process.platform),
    session_target: sanitizeIdentifier(targetId),
    observed_evidence: evidence,
    safe_remedy: remedy,
    human_required: humanRequired,
    retryable,
    error: String(message || code).slice(0, 500),
  };
}

export function classifyVisibleFailure(result = {}) {
  const reason = String(result.reason || result.status || '');
  if (/DESKTOP|WINDOW_NOT_DETECTED/.test(reason)) return 'WEB_VISIBLE_DESKTOP_MISSING';
  if (/FOREGROUND|TARGET_MISMATCH|TARGET_STALE/.test(reason)) return 'WEB_FOREGROUND_TARGET_MISMATCH';
  if (/PROMPT|MODAL|CONSENT/.test(reason)) return 'WEB_COOKIE_ACTION_REQUIRED';
  if (/DRAIN/.test(reason)) return 'WEB_WORKER_DRAINING';
  if (/BUSY|OWNER/.test(reason)) return 'WEB_VISIBLE_SESSION_BUSY';
  if (/POLICY|DENIED/.test(reason)) return 'WEB_POLICY_DENIED';
  return 'WEB_VISIBLE_SESSION_REQUIRED';
}
