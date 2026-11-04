import assert from 'node:assert/strict';
import { evaluateLocatorBatches } from '../playwright-worker/src/dom-capture-batches.js';
import { chromium } from '../playwright-worker/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/microsoft-edge' });
try {
  const page = await browser.newPage();
  await page.setContent('<input value="ready">');
  assert.equal(await page.locator('input').evaluate(node => node.value), 'ready');
  await page.evaluate(() => { const fragment = document.createDocumentFragment(); for (let i = 0; i < 1205; i++) { const input = document.createElement('input'); input.value = String(i); fragment.append(input); } document.body.append(fragment); });
  const locator = page.locator('input');
  const values = await evaluateLocatorBatches(locator, (offset, size) => Promise.all(Array.from({ length: size }, (_, localIndex) => locator.nth(offset + localIndex).evaluate((node, index) => ({ index, value: node.value }), offset + localIndex))));
  assert.equal(values.length, 1206);
  assert.deepEqual(values[0], { index: 0, value: 'ready' });
  for (let i = 1; i < values.length; i++) assert.deepEqual(values[i], { index: i, value: String(i - 1) });
  console.log('HEADLESS_DOM_CAPTURE_PASS count=' + values.length);
} finally {
  await browser.close();
}
