import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from '../playwright-worker/node_modules/@playwright/test/index.mjs';
import { readControlState, observeExpectedOutcome } from '../playwright-worker/src/action-postcondition.js';
import { settleSubmitPostcondition } from '../playwright-worker/src/submit-postcondition.js';
import { settleClickTransition } from '../playwright-worker/src/click-transition-settle.js';
let submissions = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', 'text/html');
  if (req.method === 'POST') {
    submissions++;
    res.writeHead(303, { Location: '/event?mode=' + url.searchParams.get('mode') });
    return res.end();
  }
  if (url.pathname === '/event') {
    const mode = url.searchParams.get('mode');
    const text = mode === 'reject' ? 'Please correct the errors below. This field is required.' : '';
    const confirmation = mode === 'success' || mode === 'delay'
      ? '<div data-testid="registered-state">Waitlisted</div>' : '';
    return res.end('<body>' + text + (mode === 'delay'
      ? '<script>setTimeout(()=>document.body.innerHTML=' + JSON.stringify(confirmation) + ',120)</script>'
      : confirmation));
  }
  res.end('<body><form method="POST" action="/apply?mode=' + url.searchParams.get('mode') +
    '"><button type="submit">Apply</button></form>' +
    '<button id="waiver" role="checkbox" aria-checked="false" onclick="this.setAttribute(\'aria-checked\',\'true\')">Waiver</button>' +
    '<button id="pressed" aria-pressed="false" onclick="this.setAttribute(\'aria-pressed\',\'true\')">Press</button>' +
    '<button id="noop" aria-selected="false">No op</button>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const capture = async expected => {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    return { targetId: targetInfo.targetId, targetIdentityVerified: Boolean(targetInfo.targetId),
      browserSessionId: 'local-fixture-context', url: page.url(),
      visibleText: await page.locator('body').innerText(),
      expectedObservation: await observeExpectedOutcome(page, expected) };
  };
  for (const mode of ['success', 'delay', 'navigation', 'reject']) {
    await page.goto(origin + '/apply?mode=' + mode);
    const expectedOutcome = { url: origin + '/event?mode=' + mode,
      element: { selector: '[data-testid="registered-state"]', text: 'Waitlisted' } };
    const before = await capture(expectedOutcome);
    const oldCount = submissions;
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    const result = await settleSubmitPostcondition({ before, expectedOutcome, intervalMs: 30,
      maxAttempts: 12, readSnapshot: async () => {
        const after = await capture(expectedOutcome);
        return { after, visibleText: after.visibleText };
      } });
    assert.equal(result.status, mode === 'navigation' ? 'WEB_SUBMIT_POSTCONDITION_UNVERIFIED'
      : mode === 'reject' ? 'WEB_SUBMIT_VALIDATION_FAILED' : 'WEB_SUBMIT_VERIFIED', mode);
    assert.equal(submissions, oldCount + 1, 'verification reads never resubmit');
    assert.equal(result.retrySafe, false);
    assert.equal(result.externalActionMayHaveOccurred, true);
    if (mode === 'delay') assert.ok(result.observationAttempts > 1);
  }
  for (const selector of ['#waiver', '#pressed', '#noop']) {
    await page.goto(origin + '/apply');
    const locator = page.locator(selector);
    const before = { ...await capture(), controlState: await locator.evaluate(readControlState) };
    await locator.click();
    const initialAfter = { ...await capture(), controlState: await locator.evaluate(readControlState) };
    const result = await settleClickTransition({ before, initialAfter, timeoutMs: 40, pollMs: 10,
      capture: async () => ({ ...await capture(), controlState: await locator.evaluate(readControlState) }) });
    assert.equal(Boolean(result.transition.controlStateChanged), selector !== '#noop', selector);
  }
  await page.goto(origin + '/apply');
  const before = await capture();
  const second = await context.newPage();
  const otherSession = await context.newCDPSession(second);
  const { targetInfo } = await otherSession.send('Target.getTargetInfo');
  const changed = { ...before, targetId: targetInfo.targetId, url: origin + '/confirmation' };
  const result = await settleSubmitPostcondition({ before,
    readSnapshot: async () => ({ after: changed, visibleText: 'Successfully submitted' }) });
  assert.equal(result.verified, false, 'unexpected real CDP target fails closed');
  assert.equal(result.evidence.kind, 'target-continuity-lost');
  console.log('Local Chromium: registration, delayed DOM, validation, navigation, ARIA, target continuity, exactly-once POST passed.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
