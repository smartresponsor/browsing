import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateLocatorBatches } from '../playwright-worker/src/dom-capture-batches.js';

function locatorFor(items) {
  return { count: async () => items.length };
}
test('reads all 1205 elements without losing indices', async () => {
  const items = Array.from({ length: 1205 }, (_, i) => i);
  const calls = [];
  const result = await evaluateLocatorBatches(locatorFor(items), async (offset, size) => {
    calls.push([offset, size]);
    return items.slice(offset, offset + size);
  });
  assert.deepEqual(result, items);
  assert.equal(calls.length, 13);
  assert.deepEqual(calls.at(-1), [1200, 5]);
});
test('rejects a changed DOM count', async () => {
  const items = Array.from({ length: 210 }, (_, i) => i);
  await assert.rejects(
    evaluateLocatorBatches(locatorFor(items), async (offset, size) => {
      if (offset === 100) items.push(210);
      return items.slice(offset, offset + size);
    }, { staleCode: 'WEB_DOM_CAPTURE_STALE_FIELDS' }),
    /WEB_DOM_CAPTURE_STALE_FIELDS/,
  );
});
test('rejects incomplete batch without silent truncation', async () => {
  const items = Array.from({ length: 201 }, (_, i) => i);
  await assert.rejects(
    evaluateLocatorBatches(locatorFor(items), async (offset, size) => items.slice(offset, offset + size - 1)),
    /WEB_DOM_CAPTURE_STALE/,
  );
});
