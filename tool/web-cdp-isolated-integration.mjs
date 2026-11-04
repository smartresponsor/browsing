import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '../playwright-worker/node_modules/playwright/index.mjs';

const profile = await mkdtemp(join(tmpdir(), 'cdp-recovery-isolated-'));
let owner;
try {
  owner = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true, args: ['--remote-debugging-port=0'] });
  const page = owner.pages()[0] ?? await owner.newPage();
  await page.goto('data:text/html,<title>isolated-cdp</title>');
  let port;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]); if (port > 0) break; } catch {}
    await delay(100);
  }
  assert.ok(port > 0, 'Isolated CDP endpoint did not become available');
  const endpoint = 'http://127.0.0.1:' + port;
  const version = await (await fetch(endpoint + '/json/version')).json();
  assert.ok(version.webSocketDebuggerUrl);
  const first = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  const second = await chromium.connectOverCDP(version.webSocketDebuggerUrl);
  try {
    assert.ok(first.contexts()[0].pages().some(p => p.url().startsWith('data:text/html')));
    assert.ok(second.contexts()[0].pages().some(p => p.url().startsWith('data:text/html')));
    await second.close();
    assert.ok((await (await fetch(endpoint + '/json/version')).json()).webSocketDebuggerUrl);
    assert.ok(first.contexts()[0].pages().length > 0);
  } finally { await first.close().catch(() => {}); await second.close().catch(() => {}); }
  console.log('Isolated real CDP connection lifecycle PASS');
} finally {
  await owner?.close().catch(() => {});
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}
