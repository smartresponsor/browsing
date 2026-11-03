import { revisionError } from './revision-contract.js';

/** Worker-local, bounded sliding window; never tied to lifetime of the attached Edge. */
export function createFillRateLimiter() {
  const history = [];
  const reservations = new Map();
  let nextId = 0;
  const current = (now, windowMs) => {
    while (history.length && history[0].at <= now - windowMs) history.shift();
    return [...history, ...reservations.values()];
  };
  return {
    reserve({ requestedWrites, maxFieldsPerOperation, maxFormFills, maxFieldWrites, windowMs, now = Date.now() }) {
      if (!Number.isSafeInteger(requestedWrites) || requestedWrites < 1 ||
          !Number.isSafeInteger(maxFieldsPerOperation) || maxFieldsPerOperation < 1 ||
          requestedWrites > maxFieldsPerOperation) {
        throw revisionError('WEB_OPERATION_SIZE_LIMIT', 'Invalid or oversized single form-fill operation.',
          { requestedWrites, maxFieldsPerOperation, kind: 'form-fill' });
      }
      if (![maxFormFills, maxFieldWrites, windowMs].every(n => Number.isSafeInteger(n) && n > 0))
        throw revisionError('WEB_RATE_POLICY_INVALID', 'Form-fill rate window policy must use positive safe integers.');
      if (requestedWrites > maxFieldWrites)
        throw revisionError('WEB_OPERATION_SIZE_LIMIT', 'Single form-fill exceeds configured field-write window ceiling.',
          { requestedWrites, maxFieldWrites, kind: 'field-write' });
      const observed = current(now, windowMs);
      const usedFills = observed.length;
      const usedWrites = observed.reduce((sum, item) => sum + item.writes, 0);
      const kind = usedFills >= maxFormFills ? 'form-fill' :
        usedWrites + requestedWrites > maxFieldWrites ? 'field-write' : null;
      if (kind) {
        const sorted = [...observed].sort((a, b) => a.at - b.at);
        let remainingFills = usedFills, remainingWrites = usedWrites;
        let nextAvailableAt = now + windowMs;
        for (const entry of sorted) {
          remainingFills -= 1;
          remainingWrites -= entry.writes;
          if (remainingFills < maxFormFills && remainingWrites + requestedWrites <= maxFieldWrites) {
            nextAvailableAt = entry.at + windowMs;
            break;
          }
        }
        const retryAfterMs = Math.max(1, nextAvailableAt - now);
        throw revisionError('WEB_RATE_LIMITED', 'Form-fill rate window exhausted; no browser mutation attempted.',
          { kind, windowSeconds: windowMs / 1000, used: kind === 'form-fill' ? usedFills : usedWrites,
            limit: kind === 'form-fill' ? maxFormFills : maxFieldWrites,
            requestedWrites, retryAfterMs, retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
            automatic_retry_allowed: false });
      }
      const id = ++nextId;
      reservations.set(id, { at: now, writes: requestedWrites });
      return id;
    },
    commit(id, now = Date.now()) {
      const entry = reservations.get(id);
      if (!entry) throw new Error('FILL_RATE_RESERVATION_MISSING');
      reservations.delete(id);
      history.push({ at: now, writes: entry.writes });
    },
    release(id) { if (id !== null && id !== undefined) reservations.delete(id); },
    snapshot({ now = Date.now(), windowMs }) {
      const active = current(now, windowMs);
      return { windowSeconds: windowMs / 1000, formFillsInWindow: active.length,
        fieldWritesInWindow: active.reduce((sum, item) => sum + item.writes, 0),
        inFlight: reservations.size };
    },
    reset() { history.length = 0; reservations.clear(); }
  };
}
