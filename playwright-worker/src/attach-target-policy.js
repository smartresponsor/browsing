export function summarizeAttachTargets(targets) {
  if (!Array.isArray(targets)) throw new TypeError('targets must be an array');
  const classified = targets.map(target => ({
    id: String(target?.id || target?.targetId || ''),
    ...classifyAttachTarget(target)
  }));
  return {
    total: classified.length,
    eligible: classified.filter(item => item.eligible).length,
    excluded: classified.filter(item => !item.eligible).length,
    reasons: classified.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, Object.create(null))
  };
}

export function classifyAttachTarget(target) {
  const type = String(target?.type || '');
  const url = String(target?.url || '');
  const id = String(target?.id || target?.targetId || '');
  if (!/^[a-f\d]{32}$/i.test(id)) return { eligible: false, reason: 'INVALID_TARGET_ID' };
  if (type !== 'page') return { eligible: false, reason: 'NOT_PAGE' };
  if (/^(edge|chrome|devtools|chrome-extension):\/\//i.test(url)) return { eligible: false, reason: 'INTERNAL_BROWSER_PAGE' };
  if (!/^https?:\/\//i.test(url)) return { eligible: false, reason: 'UNSUPPORTED_SCHEME' };
  return { eligible: true, reason: 'WEB_PAGE' };
}
