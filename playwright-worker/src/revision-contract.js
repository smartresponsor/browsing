import { createHash } from 'node:crypto';

export function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

export function hashStableJson(value) {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

export function buildRevisionEnvelope({ targetId, url, title, textHash, fields }) {
  const formRevision = hashStableJson(fields);
  const pageRevision = hashStableJson({
    targetId,
    url,
    title,
    textHash,
    formRevision,
  });

  return {
    targetId,
    pageRevision,
    formRevision,
    formHash: formRevision,
  };
}

export function assertExpectedRevisions(expected, actual, options = {}) {
  const expectedTargetId = normalize(expected?.targetId);
  const expectedPageRevision = normalize(expected?.pageRevision);
  const expectedFormRevision = normalize(expected?.formRevision);
  const allowPageRevisionDriftWhenFormStable = options?.allowPageRevisionDriftWhenFormStable === true;

  if (expectedTargetId && expectedTargetId !== actual.targetId) {
    throw revisionError(
      'NETWORK_TARGET_STALE',
      'The bound browser target no longer matches the expected target identity.',
      { expectedTargetId, actualTargetId: actual.targetId },
    );
  }

  const formRevisionStable = Boolean(expectedFormRevision && expectedFormRevision === actual.formRevision);
  if (
    expectedPageRevision &&
    expectedPageRevision !== actual.pageRevision &&
    !(allowPageRevisionDriftWhenFormStable && formRevisionStable)
  ) {
    throw revisionError(
      'NETWORK_PAGE_REVISION_STALE',
      'The page revision changed after inspection. Capture a fresh page snapshot before mutating.',
      { expectedPageRevision, actualPageRevision: actual.pageRevision },
    );
  }

  if (expectedFormRevision && expectedFormRevision !== actual.formRevision) {
    throw revisionError(
      'NETWORK_FORM_REVISION_STALE',
      'The form revision changed after inspection. Re-inspect the form before mutating.',
      { expectedFormRevision, actualFormRevision: actual.formRevision },
    );
  }

  return true;
}

export function revisionError(status, message, evidence = {}) {
  const error = new Error(message);
  error.networkStatus = status;
  error.evidence = evidence;
  return error;
}

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

