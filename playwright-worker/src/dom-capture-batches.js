export async function evaluateLocatorBatches(locator, mapper, { batchSize = 100, staleCode = 'WEB_DOM_CAPTURE_STALE' } = {}) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError('Invalid batchSize');
  const initialCount = await locator.count();
  if (!Number.isSafeInteger(initialCount) || initialCount < 0) throw new Error(staleCode);
  const results = [];
  for (let offset = 0; offset < initialCount; offset += batchSize) {
    const batch = await mapper(offset, Math.min(batchSize, initialCount - offset));
    if (!Array.isArray(batch) || batch.length !== Math.min(batchSize, initialCount - offset)) throw new Error(staleCode);
    results.push(...batch);
  }
  if (await locator.count() !== initialCount || results.length !== initialCount) throw new Error(staleCode);
  return results;
}
