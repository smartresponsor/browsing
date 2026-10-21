// Explicit, revision-independent observation of an existing target must not steal the
// shared worker's active page or launch a competing browser.
const exactCdpTarget = /^[A-Fa-f0-9]{32}$/;

export function isTargetedReadCapture(route, body) {
  return ['/page-capture', '/page-capture-dom', '/page-capture-form'].includes(route)
    && exactCdpTarget.test(body?.targetId ?? '');
}

export function readPostconditionTargetId(preserveActiveTarget, verifiedTargetId, activeTargetId) {
  return preserveActiveTarget ? verifiedTargetId : (activeTargetId ?? verifiedTargetId);
}
