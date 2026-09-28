function transitionBetween(before, after) {
  return {
    targetChanged: before.targetId !== after.targetId,
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
  let after = initialAfter;
  let transition = transitionBetween(before, after);
  if (Object.values(transition).some(Boolean)) {
    return { after, transition, settled: false, elapsedMs: 0 };
  }

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(10, pollMs)));
    after = await capture();
    transition = transitionBetween(before, after);
    if (Object.values(transition).some(Boolean)) {
      return {
        after,
        transition,
        settled: true,
        elapsedMs: Date.now() - startedAt
      };
    }
  }

  return {
    after,
    transition,
    settled: false,
    elapsedMs: Date.now() - startedAt
  };
}
