import { identityFailure, observationSummary } from './action-postcondition.js';

function transitionBetween(before, after) {
  return {
    targetChanged: false,
    controlStateChanged: Boolean(before.controlState && after.controlState && JSON.stringify(before.controlState) !== JSON.stringify(after.controlState)),
    urlChanged: before.url !== after.url,
    pageRevisionChanged: before.pageRevision !== after.pageRevision,
    formRevisionChanged: before.formRevision !== after.formRevision
  };
}

export async function settleClickTransition({
  before,
  initialAfter,
  capture,
  timeoutMs = 1500,
  pollMs = 100
}) {
  const startedAt = Date.now();
  const deadline = startedAt + Math.min(3000, Math.max(0, timeoutMs));
  const captureBounded = async () => {
    let timer;
    return Promise.race([
      Promise.resolve().then(capture),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Observation deadline exceeded')), Math.max(1, deadline - Date.now())); })
    ]).finally(() => clearTimeout(timer));
  };
  let after = initialAfter;
  if (!after) {
    try { after = await captureBounded(); }
    catch { return { after: null, transition: {}, settled: false, elapsedMs: Date.now() - startedAt,
      identityError: 'observation-unavailable', observations: [] }; }
  }
  const observations = [];
  const checkIdentity = () => identityFailure(before, after);
  let identityError = checkIdentity();
  if (identityError) return { after, transition: {}, settled: false, elapsedMs: 0, identityError, observations };
  let transition = transitionBetween(before, after);
  observations.push(observationSummary(before, after, 1, 0, { verified: (transition.urlChanged || transition.controlStateChanged) === true }));
  if ((transition.urlChanged || transition.controlStateChanged) === true) {
    return { after, transition, settled: false, elapsedMs: 0, observations };
  }

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(10, pollMs), Math.max(0, deadline - Date.now()))));
    try {
      after = await captureBounded();
    } catch {
      return { after, transition: {}, settled: false, elapsedMs: Date.now() - startedAt,
        identityError: 'observation-unavailable', observations };
    }
    identityError = checkIdentity();
    if (identityError) return { after, transition: {}, settled: false,
      elapsedMs: Date.now() - startedAt, identityError, observations };
    transition = transitionBetween(before, after);
    observations.push(observationSummary(before, after, observations.length + 1,
      Date.now() - startedAt, { verified: (transition.urlChanged || transition.controlStateChanged) === true }));
    if ((transition.urlChanged || transition.controlStateChanged) === true) {
      return {
        after,
        transition,
        settled: true,
        elapsedMs: Date.now() - startedAt,
        observations
      };
    }
  }

  return {
    after,
    transition,
    settled: false,
    elapsedMs: Date.now() - startedAt,
    observations
  };
}
