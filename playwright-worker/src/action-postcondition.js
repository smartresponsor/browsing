import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// An expected outcome is an observation contract, never authority to act.
export function validateExpectedOutcome(value) {
  if (value === undefined) return undefined;
  const fail = () => { throw new TypeError('Invalid expectedOutcome: require bounded selector/text and optional HTTP(S) URL'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  if (Object.keys(value).some(key => !['url', 'element'].includes(key))) fail();
  const e = value.element;
  if (!e || typeof e !== 'object' || Array.isArray(e) ||
      Object.keys(e).some(key => !['selector', 'text'].includes(key)) ||
      typeof e.selector !== 'string' || !e.selector.trim() || e.selector.length > 500 ||
      typeof e.text !== 'string' || !e.text.trim() || e.text.length > 500) fail();
  if (value.url !== undefined) {
    let url;
    try { url = new URL(value.url); } catch { fail(); }
    if (typeof value.url !== 'string' || value.url.length > 2048 ||
        !['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail();
  }
  return { ...(value.url === undefined ? {} : { url: value.url }), element: { ...e } };
}

export function expectedOutcomeMatches(expected, observation, url) {
  return Boolean(expected && (!expected.url || expected.url === url) &&
    observation?.count === 1 && observation.visible === true &&
    observation.text === expected.element.text.replace(/\s+/g, ' ').trim());
}

// This function is also exercised in a real Chromium DOM fixture.
export function readControlState(node) {
  return {
    checked: typeof node.checked === 'boolean' ? node.checked : null,
    selected: typeof node.selected === 'boolean' ? node.selected : null,
    ariaChecked: node.getAttribute('aria-checked'),
    ariaPressed: node.getAttribute('aria-pressed'),
    ariaSelected: node.getAttribute('aria-selected'),
    ariaExpanded: node.getAttribute('aria-expanded')
  };
}

export async function observeExpectedOutcome(target, expected) {
  if (!expected) return null;
  const locator = target.locator(expected.element.selector);
  const count = await locator.count();
  if (count !== 1) return { count, visible: false, text: null };
  const visible = await locator.isVisible();
  return { count, visible, text: visible
    ? String(await locator.innerText()).replace(/\s+/g, ' ').trim().slice(0, 501) : null };
}

export function identityFailure(before, after) {
  if (!before?.targetId || !after?.targetId ||
      before.targetId.startsWith('fallback:') || after.targetId.startsWith('fallback:') ||
      before.targetIdentityVerified !== true || after.targetIdentityVerified !== true ||
      !before.browserSessionId || before.browserSessionId !== after.browserSessionId) {
    return 'session-identity-unverified';
  }
  return before.targetId !== after.targetId ? 'target-continuity-lost' : null;
}

export function assertActionIdentity(before, after = before) {
  const reason = identityFailure(before, after);
  if (reason) {
    const error = new Error(reason);
    error.webStatus = 'WEB_VISIBLE_SESSION_REQUIRED';
    throw error;
  }
}

export function observationSummary(before, after, attempt, elapsedMs, result) {
  return {
    attempt, elapsedMs, targetId: after?.targetId ?? null,
    browserSessionId: after?.browserSessionId ?? null,
    url: after?.url ?? null, pageRevision: after?.pageRevision ?? null,
    formRevision: after?.formRevision ?? null,
    navigationObserved: Boolean(before?.url && after?.url && before.url !== after.url),
    expectedObservation: after?.expectedObservation ?? null,
    controlState: after?.controlState ?? null,
    matched: result.verified === true, kind: result.evidence?.kind ?? result.identityError ?? null
  };
}

function evidenceState(value) {
  if (!value) return null;
  return {
    targetId: value.targetId ?? null, browserSessionId: value.browserSessionId ?? null,
    url: value.url ?? null, pageRevision: value.pageRevision ?? null,
    formRevision: value.formRevision ?? null, controlState: value.controlState ?? null,
    expectedObservation: value.expectedObservation ?? null
  };
}

// Keep action evidence beside the existing review artifacts; never persist form values.
export async function writeActionEvidence(route, result, directory = path.join('var', 'browser')) {
  const artifactPath = path.join(directory, 'action-' + randomUUID() + '.json');
  const record = {
    timestamp: new Date().toISOString(), action: route, target: result.clicked ?? null,
    correlation: result.correlation ?? null, outcome: result.outcome ?? 'unresolved',
    status: result.status, verified: result.verified === true, retrySafe: result.retrySafe === true,
    externalActionMayHaveOccurred: result.externalActionMayHaveOccurred === true,
    before: evidenceState(result.before), after: evidenceState(result.after),
    evidence: result.evidence ?? null, observations: result.observations ?? null,
    elapsedMs: result.elapsedMs ?? result.settling?.elapsedMs ?? null,
    visibleSession: result.visible_session ?? null
  };
  await mkdir(directory, { recursive: true });
  await writeFile(artifactPath, JSON.stringify(record, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return artifactPath;
}
