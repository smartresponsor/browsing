// Explicit read observations must not steal a shared browser worker's active tab.
const exactTargetId = /^[A-Fa-f0-9]{32}$/;
const captureRoutes = new Set(['/page-capture', '/page-capture-dom', '/page-capture-form']);
export function isTargetedReadCapture(route, input) {
  return captureRoutes.has(route) && exactTargetId.test(input?.targetId ?? '');
}
export function readPostconditionTargetId(preserveActiveTarget, verifiedTargetId, activeTargetId) {
  return preserveActiveTarget ? verifiedTargetId : (activeTargetId ?? verifiedTargetId);
}
