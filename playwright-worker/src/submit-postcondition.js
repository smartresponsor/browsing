import { expectedOutcomeMatches, identityFailure, observationSummary } from './action-postcondition.js';

/**
 * Observe a single already-triggered submit without ever repeating its mutation.
 * A transient SPA transition may reveal the confirmation several moments later.
 * Capture errors preserve the unknown-outcome state, not permission to retry.
 */
export async function settleSubmitPostcondition({
  before,
  readSnapshot,
  expectedOutcome,
  timeoutMs = 12000,
  maxAttempts = 12,
  intervalMs = 750,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (typeof readSnapshot !== 'function') throw new TypeError('readSnapshot is required');
  const attempts = Math.min(16, Math.max(1, Number.isInteger(maxAttempts) ? maxAttempts : 12));
  const pause = Math.min(1500, Math.max(0, Number.isFinite(intervalMs) ? intervalMs : 750));
  const startedAt = Date.now();
  const budgetMs = Math.min(12000, Math.max(1, timeoutMs));
  const observations = [];
  let latest = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(Math.min(pause, Math.max(0, budgetMs - (Date.now() - startedAt))));
    try {
      const remaining = budgetMs - (Date.now() - startedAt);
      if (remaining <= 0) break;
      let timer;
      const snapshot = await Promise.race([
        Promise.resolve().then(readSnapshot),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Observation deadline exceeded')), remaining); })
      ]).finally(() => clearTimeout(timer));
      if (!snapshot?.after) throw new Error('No page evidence');
      const identityError = identityFailure(before, snapshot.after);
      if (identityError) return {
        ok: false, status: 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED', verified: false,
        retrySafe: false, externalActionMayHaveOccurred: true, outcome: 'unresolved',
        after: snapshot.after, observationAttempts: attempt,
        evidence: { kind: identityError }, observations,
        elapsedMs: Date.now() - startedAt
      };
      const result = classifySubmitPostcondition({
        before,
        after: snapshot.after,
        visibleText: snapshot.visibleText,
        expectedOutcome
      });
      observations.push(observationSummary(before, snapshot.after, attempt, Date.now() - startedAt, result));
      latest = { ...result, after: snapshot.after, observationAttempts: attempt, observations,
        elapsedMs: Date.now() - startedAt, externalActionMayHaveOccurred: true,
        outcome: result.verified ? 'success' : result.status === 'WEB_SUBMIT_VALIDATION_FAILED' ? 'rejected' : 'unresolved' };
      // A form may display stale validation text while the accepted submission
      // is still navigating to its confirmation screen. Only success is final.
      if (result.verified) return latest;
    } catch (error) {
      latest = null;
      lastError = String(error?.message || error).slice(0, 300);
      observations.push({ attempt, elapsedMs: Date.now() - startedAt, kind: 'observation-error', error: lastError });
    }
  }
  return latest
    ? { ...latest, observationAttempts: observations.length, elapsedMs: Date.now() - startedAt, ...(lastError ? { lastObservationError: lastError } : {}) }
    : {
        ok: false,
        status: 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED',
        verified: false,
        retrySafe: false,
        externalActionMayHaveOccurred: true,
        observationAttempts: observations.length,
        elapsedMs: Date.now() - startedAt, observations, outcome: 'unresolved',
        evidence: { kind: 'observation-unavailable', lastObservationError: lastError }
      };
}

export function classifySubmitPostcondition({ before, after, visibleText, expectedOutcome }) {
  const text = normalize(visibleText);
  const lower = text.toLowerCase();

  const confirmationPatterns = [
    /application (?:has been )?submitted/,
    /application received/,
    /your application has been received/,
    /thank you for applying/,
    /we (?:have )?received your application/,
    /thank you for (?:your )?(?:application|submission)/,
    /successfully submitted/,
    /submission (?:is )?complete/,
    /confirmation (?:number|id|code)/,
    /your response has been recorded/,
    /your submission has been received/
  ];

  const validationPatterns = [
    /please correct the (?:errors?|following)/,
    /please fix the (?:errors?|following)/,
    /this field is required/,
    /there (?:is|are) .* errors?/,
    /unable to submit/,
    /submission failed/,
    /invalid security code/,
    /security code (?:expired|invalid)/,
    /incorrect (?:security )?code/
  ];

  // Ignore boilerplate or errors already present in the approved pre-submit
  // snapshot. Greenhouse adds '* indicates a required field' to every form.
  const beforeText = normalize(before?.visibleText).toLowerCase();
  const validationMatch = validationPatterns.find(pattern =>
    pattern.test(lower) && !pattern.test(beforeText));
  if (validationMatch) {
    return {
      ok: false,
      status: 'WEB_SUBMIT_VALIDATION_FAILED',
      verified: false,
      retrySafe: false,
      evidence: {
        kind: 'validation-text',
        text: extractEvidence(text, validationMatch)
      }
    };
  }

  if (expectedOutcome) {
    const matched = expectedOutcomeMatches(expectedOutcome, after?.expectedObservation, after?.url);
    const existedBefore = expectedOutcomeMatches({ ...expectedOutcome, url: undefined },
      before?.expectedObservation, before?.url);
    return {
      ok: matched && !existedBefore,
      status: matched && !existedBefore ? 'WEB_SUBMIT_VERIFIED' : 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED',
      verified: matched && !existedBefore, retrySafe: false, externalActionMayHaveOccurred: true,
      evidence: { kind: 'expected-outcome', matched, existedBefore,
        expectedOutcome, observation: after?.expectedObservation ?? null }
    };
  }

  // A job page can quote a success phrase in an FAQ or template before
  // submission. It is confirmation evidence only when it appears newly or on
  // a distinct confirmation/thank-you route reached after the approved click.
  const reachedConfirmationRoute = Boolean(before?.url && after?.url && before.url !== after.url &&
    /\/(?:confirmation|thank-you|submitted)(?:[/?#]|$)/i.test(after.url));
  const confirmationMatch = confirmationPatterns.find(pattern =>
    pattern.test(lower) && (!pattern.test(beforeText) || reachedConfirmationRoute));
  if (confirmationMatch) {
    return {
      ok: true,
      status: 'WEB_SUBMIT_VERIFIED',
      verified: true,
      retrySafe: false,
      evidence: {
        kind: 'confirmation-text',
        text: extractEvidence(text, confirmationMatch)
      }
    };
  }

  const urlChanged = Boolean(before?.url && after?.url && before.url !== after.url);
  const pageRevisionChanged = Boolean(
    before?.pageRevision &&
    after?.pageRevision &&
    before.pageRevision !== after.pageRevision
  );

  return {
    ok: false,
    status: 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED',
    verified: false,
    retrySafe: false,
    externalActionMayHaveOccurred: true,
    evidence: {
      kind: 'insufficient-confirmation-evidence',
      urlChanged,
      pageRevisionChanged,
      beforeUrl: before?.url ?? null,
      afterUrl: after?.url ?? null
    }
  };
}

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 20000);
}

function extractEvidence(text, pattern) {
  const match = pattern.exec(text.toLowerCase());
  if (!match || typeof match.index !== 'number') {
    return text.slice(0, 300);
  }

  const start = Math.max(0, match.index - 100);
  const end = Math.min(text.length, match.index + match[0].length + 160);
  return text.slice(start, end);
}
