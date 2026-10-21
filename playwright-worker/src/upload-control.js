import { uploadError } from './upload-artifact.js';

export function chooseUploadField(fields, controlId = '') {
  const candidates = Array.isArray(fields) ? fields : [];
  const id = String(controlId || '').trim();
  if (id) {
    const field = candidates.find(item => item.controlId === id);
    if (!field) {
      throw uploadError('WEB_FIELD_NOT_FOUND', 'File control identity is stale or missing.', { controlId: id });
    }
    if (field.semanticType !== 'file') {
      throw uploadError('WEB_CONTROL_UNSUPPORTED', 'The requested control is not a file input.', { controlId: id });
    }
    if (!field.enabled) {
      throw uploadError('WEB_CONTROL_UNSUPPORTED', 'The requested file input is disabled.', { controlId: id });
    }
    return field;
  }
  // No guessing between distinct resume, cover-letter or other upload controls.
  const eligible = candidates.filter(item => item.semanticType === 'file' && item.enabled);
  if (eligible.length !== 1) {
    throw uploadError(
      eligible.length ? 'WEB_FIELD_AMBIGUOUS' : 'WEB_UPLOAD_CONTROL_REQUIRED',
      'Specify the exact file controlId or selector unless exactly one enabled file input exists.',
      { eligibleControlCount: eligible.length }
    );
  }
  return eligible[0];
}

export function assertSafeUploadActivator(candidate, { allowLocalComputerMenuItem = false } = {}) {
  const tag = String(candidate?.tag || '').toLowerCase();
  const role = String(candidate?.role || '').toLowerCase();
  const label = String(candidate?.label || '').replace(/\s+/g, ' ').trim().slice(0, 250);
  const marker = String(candidate?.marker || '').toLowerCase();
  // Never click a submit/reset button or a link as an upload activator.
  // A button without type=button inside a form defaults to type=submit.
  const type = String(candidate?.type || '').toLowerCase();
  const localComputerItem = allowLocalComputerMenuItem && tag === 'li' && role === 'menuitem' && label === 'My computer';
  const semanticTrigger = localComputerItem || tag === 'label' || (tag === 'button' && !['submit', 'reset'].includes(type))
    || (['div', 'span'].includes(tag) && role === 'button')
    || (tag === 'div' && /(?:dropzone|file-upload|upload-trigger)/.test(marker));
  const uploadIntent = localComputerItem || /\b(upload|attach|browse|choose files?|select files?|drop files?|add (?:resume|cv|attachment))\b/i.test(label);
  const forbidden = /\b(submit|apply|finish|delete|remove|withdraw|purchase|pay|checkout|confirm|continue|next|save)\b/i.test(label);
  if (!candidate?.visible || !candidate?.enabled || !semanticTrigger || !uploadIntent || forbidden) {
    throw uploadError('WEB_UPLOAD_TRIGGER_UNSAFE',
      'The selector is not an unambiguous, enabled, visible upload/dropzone activator.',
      { tag, role, label: label.slice(0, 100), semanticTrigger, uploadIntent, forbidden });
  }
  return { tag, role, label };
}

export async function selectGuardedUploadFile({
  locator, artifact, performSelection, maxAttempts = 3,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  if (!locator || !artifact?.filePath || !artifact?.artifact) {
    throw new TypeError('A verified file locator and guarded artifact are required.');
  }

  // Hidden native inputs are normal for Workday, React and dropzone widgets.
  // Playwright setInputFiles supports them without clicking the visual trigger.
  const live = await locator.evaluate(node => ({
    tag: String(node.tagName || '').toLowerCase(),
    type: String(node.getAttribute('type') || '').toLowerCase(),
    enabled: !node.disabled && node.getAttribute('aria-disabled') !== 'true'
  }));
  if (live.tag !== 'input' || live.type !== 'file' || !live.enabled) {
    throw uploadError('WEB_CONTROL_UNSUPPORTED', 'The bound control is not an enabled native file input.', {
      tag: live.tag, type: live.type, enabled: live.enabled
    });
  }

  // The single approved mutation. Never reapply files if a reactive form swaps
  // or detaches the input before postcondition observation.
  try {
    if (performSelection) await performSelection(artifact.filePath);
    else await locator.setInputFiles(artifact.filePath);
  } catch (error) {
    throw uploadError('WEB_UPLOAD_DISPATCH_UNVERIFIED',
      'File selection did not return a confirmed result. Inspect the current form; do not automatically retry.',
      {
        externalActionMayHaveOccurred: true,
        automaticRetryAllowed: false,
        dispatchError: String(error?.message || error).slice(0, 300)
      });
  }
  const attempts = Math.min(5, Math.max(1, Number.isInteger(maxAttempts) ? maxAttempts : 3));
  let lastObservationError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep(200);
    try {
      const uploaded = await locator.evaluate(node => Array.from(node.files || []).map(file => ({
        name: String(file.name || ''),
        size: Number(file.size || 0),
        type: String(file.type || '')
      })));
      const matched = uploaded.find(file =>
        file.name === artifact.artifact.filename && file.size === artifact.artifact.size);
      if (matched) {
        return {
          status: 'WEB_UPLOAD_INPUT_VERIFIED',
          selectionVerified: true,
          serverAcceptanceVerified: false,
          observationAttempts: attempt,
          uploaded: { filename: matched.name, size: matched.size, type: matched.type }
        };
      }
    } catch (error) {
      lastObservationError = String(error?.message || error).slice(0, 300);
    }
  }
  throw uploadError(
    'WEB_UPLOAD_POSTCONDITION_UNVERIFIED',
    'The file selection was dispatched, but the input no longer confirms the requested filename and size. Inspect the page before any further upload.',
    {
      externalActionMayHaveOccurred: true,
      automaticRetryAllowed: false,
      observationAttempts: attempts,
      ...(lastObservationError ? { lastObservationError } : {})
    }
  );
}

