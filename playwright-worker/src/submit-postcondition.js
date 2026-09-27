export function classifySubmitPostcondition({ before, after, visibleText }) {
  const text = normalize(visibleText);
  const lower = text.toLowerCase();

  const confirmationPatterns = [
    /application (?:has been )?submitted/,
    /application received/,
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

  const confirmationMatch = confirmationPatterns.find(pattern => pattern.test(lower));
  if (confirmationMatch) {
    return {
      ok: true,
      status: 'NETWORK_SUBMIT_VERIFIED',
      verified: true,
      retrySafe: false,
      evidence: {
        kind: 'confirmation-text',
        text: extractEvidence(text, confirmationMatch)
      }
    };
  }

  const validationMatch = validationPatterns.find(pattern => pattern.test(lower));
  if (validationMatch) {
    return {
      ok: false,
      status: 'NETWORK_SUBMIT_VALIDATION_FAILED',
      verified: false,
      retrySafe: false,
      evidence: {
        kind: 'validation-text',
        text: extractEvidence(text, validationMatch)
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
    status: 'NETWORK_SUBMIT_POSTCONDITION_UNVERIFIED',
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

