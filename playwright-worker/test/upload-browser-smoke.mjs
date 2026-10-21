import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { assertSafeUploadActivator, selectGuardedUploadFile } from '../src/upload-control.js';

// Isolated headless Edge process: never connects to or closes the shared visible CDP session.
const root = await mkdtemp(path.join(os.tmpdir(), 'browser-mcp-upload-smoke-'));
const filename = 'fixture-resume.pdf';
const filePath = path.join(root, filename);
const payload = Buffer.from('%PDF-1.4\n% test file, not a personal resume\n', 'utf8');
const artifact = { filePath, artifact: { filename, size: payload.byteLength } };
await writeFile(filePath, payload);
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.setContent('<input id="hidden" type="file" accept=".pdf" style="display:none"><div id="picked"></div><script>document.getElementById("hidden").addEventListener("change", e => {document.getElementById("picked").textContent = e.target.files[0]?.name || "";})<\/script>');
  assert.equal(await page.locator('#hidden').isVisible(), false);
  const hidden = await selectGuardedUploadFile({ locator: page.locator('#hidden'), artifact });
  assert.equal(hidden.selectionVerified, true);
  assert.equal(hidden.serverAcceptanceVerified, false);
  assert.equal(await page.locator('#picked').innerText(), filename);

  await page.setContent('<iframe id="cv-frame"></iframe>');
  const iframe = page.frameLocator('#cv-frame');
  await page.locator('#cv-frame').evaluate(frame => {
    frame.contentDocument.body.innerHTML = '<input id="resume" type="file" style="visibility:hidden">';
  });
  const framed = await selectGuardedUploadFile({ locator: iframe.locator('#resume'), artifact });
  assert.equal(framed.selectionVerified, true);

  await page.setContent('<button id="attach" type="button">Attach Resume</button><div id="result"></div><script>window.chooserClicks=0;document.getElementById("attach").onclick=()=>{window.chooserClicks++;const input=document.createElement("input");input.type="file";input.style.display="none";input.addEventListener("change",()=>{document.getElementById("result").textContent=input.files[0]?.name||""});document.body.appendChild(input);input.click();};<\/script>');
  const activation = page.locator('#attach');
  const metadata = await activation.evaluate(node => ({
    tag: node.tagName.toLowerCase(),
    type: node.type,
    label: node.textContent,
    visible: true,
    enabled: !node.disabled,
  }));
  assertSafeUploadActivator(metadata);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 12000 }),
    activation.click(),
  ]);
  const selected = await selectGuardedUploadFile({
    locator: await chooser.element(),
    artifact,
    performSelection: selectedPath => chooser.setFiles(selectedPath),
  });
  assert.equal(selected.selectionVerified, true);
  assert.equal(await page.locator('#result').innerText(), filename);
  assert.equal(await page.evaluate(() => window.chooserClicks), 1);
  console.log('WEB_UPLOAD_BROWSER_SMOKE_GREEN: hidden input, iframe input, safe dynamic FileChooser');
} finally {
  await browser?.close();
  await rm(root, { recursive: true, force: true });
}

