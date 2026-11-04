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
