export function classifyFinalActionCandidate({ text = '', type = '' } = {}) {
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedType = String(type || '').trim().toLowerCase();

  if (normalizedType === 'submit') {
    return true;
  }

  if (/\b(delete|withdraw|purchase|payment)\b/i.test(normalizedText)) {
    return true;
  }

  if (/\bsubmit(?:\s+(?:application|form|response))?\b/i.test(normalizedText)) {
    return true;
  }

  if (/\b(?:finish|complete)\s+(?:application|submission|checkout)\b/i.test(normalizedText)) {
    return true;
  }

  if (/\bconfirm(?:\s+(?:submission|application|purchase|payment))?\b/i.test(normalizedText)) {
    return true;
  }

  return false;
}
