/**
 * Observe a single already-triggered submit without ever repeating its mutation.
 * A transient SPA transition may reveal the confirmation several moments later.
 * Capture errors preserve the unknown-outcome state, not permission to retry.
 */
export async function settleSubmitPostcondition({
  before,
  readSnapshot,
  maxAttempts = 5,
  intervalMs = 600,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (typeof readSnapshot !== 'function') throw new TypeError('readSnapshot is required');
  const attempts = Math.min(8, Math.max(1, Number.isInteger(maxAttempts) ? maxAttempts : 5));
  const pause = Math.min(1500, Math.max(0, Number.isFinite(intervalMs) ? intervalMs : 600));
  let latest = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(pause);
    try {
      const snapshot = await readSnapshot();
      if (!snapshot?.after) throw new Error('No page evidence');
      const result = classifySubmitPostcondition({
        before,
        after: snapshot.after,
        visibleText: snapshot.visibleText
      });
      latest = { ...result, after: snapshot.after, observationAttempts: attempt };
      if (result.verified || result.status === 'WEB_SUBMIT_VALIDATION_FAILED') return latest;
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 300);
    }
  }
  return latest
    ? { ...latest, observationAttempts: attempts, ...(lastError ? { lastObservationError: lastError } : {}) }
    : {
        ok: false,
        status: 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED',
        verified: false,
        retrySafe: false,
        externalActionMayHaveOccurred: true,
        observationAttempts: attempts,
        evidence: { kind: 'observation-unavailable', lastObservationError: lastError }
      };
}

export function classifySubmitPostcondition({ before, after, visibleText }) {
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
    /required field/,
    /this field is required/,
    /there (?:is|are) .* errors?/,
    /unable to submit/,
    /submission failed/
  ];

  const validationMatch = validationPatterns.find(pattern => pattern.test(lower));
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

  const confirmationMatch = confirmationPatterns.find(pattern => pattern.test(lower));
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
