import express from 'express';
import { chromium } from '@playwright/test';
import { mkdir } from 'fs/promises';
import path from 'path';

const app = express();
app.use(express.json({ limit: '2mb' }));

let browser;
let page;
let sessionStartedAt = null;
let pageVisitCount = 0;
let formFillCount = 0;
let fieldWriteCount = 0;
const SAFE_FIELD_TAGS = new Set(['input', 'textarea', 'select']);
const UNSAFE_INPUT_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset']);
const JOB_BOARD_HOSTS = new Set([
  'job-boards.greenhouse.io',
  'boards.greenhouse.io',
  'jobs.lever.co',
  'ashbyhq.com',
  'jobs.ashbyhq.com',
  'workable.com',
  'bamboohr.com',
  'smartrecruiters.com',
  'myworkdayjobs.com'
]);
const TRACKING_QUERY_PARAMS = new Set([
  'gh_src',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'ref',
  'src',
  'source',
  'trk'
]);

function parseList(value) {
  return String(value || '')
    .split(/[,;\r\n]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

function parseBrowserWorkerToken() {
  return String(process.env.NETWORK_MCP_BROWSER_WORKER_TOKEN || '').trim();
}

function getPolicy() {
  return {
    headless: String(process.env.NETWORK_MCP_HEADLESS || 'false').toLowerCase() === 'true',
    requireApprovalForFill: String(process.env.NETWORK_MCP_REQUIRE_APPROVAL_FOR_FILL || 'true').toLowerCase() !== 'false',
    requireApprovalForSubmit: String(process.env.NETWORK_MCP_REQUIRE_APPROVAL_FOR_SUBMIT || 'true').toLowerCase() !== 'false',
    submitEnabled: String(process.env.NETWORK_MCP_ENABLE_SUBMIT || 'false').toLowerCase() === 'true',
    maxSessionSeconds: Number(process.env.NETWORK_MCP_MAX_SESSION_SECONDS || 7200),
    maxPageVisits: Number(process.env.NETWORK_MCP_MAX_PAGE_VISITS || 100),
    maxFormFills: Number(process.env.NETWORK_MCP_MAX_FORM_FILLS || 20),
    maxFieldWrites: Number(process.env.NETWORK_MCP_MAX_FIELD_WRITES || 80),
    allowedHosts: parseList(process.env.NETWORK_MCP_ALLOWED_HOSTS),
    deniedHosts: parseList(process.env.NETWORK_MCP_DENIED_HOSTS)
  };
}

function hostMatches(host, pattern) {
  return host === pattern || host.endsWith(`.${pattern}`);
}

function isIPv4Address(host) {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every(part => {
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const value = Number(part);
    if (part.length > 1 && part.startsWith('0')) {
      return false;
    }

    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function isBuiltInDeniedHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  if (host === 'metadata.google.internal' || host.endsWith('.metadata.google.internal')) {
    return true;
  }

  if (host === '0.0.0.0' || host === '::1') {
    return true;
  }

  if (isIPv4Address(host)) {
    const parts = host.split('.').map(part => Number(part));
    const [a, b] = parts;

    if (a === 127) {
      return true;
    }

    if (a === 10) {
      return true;
    }

    if (a === 169 && b === 254) {
      return true;
    }

    if (a === 192 && b === 168) {
      return true;
    }

    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
  }

  return false;
}

function isSafeEditableInputType(type) {
  return !UNSAFE_INPUT_TYPES.has(type);
}

function isChallengeText(text) {
  return /captcha|2fa|two-factor|security check|challenge|bot detection|verify you are human|access denied/i.test(text);
}

async function closeSession() {
  if (page) {
    await page.close().catch(() => {});
    page = undefined;
  }

  if (browser) {
    await browser.close().catch(() => {});
    browser = undefined;
  }

  sessionStartedAt = null;
  pageVisitCount = 0;
  formFillCount = 0;
  fieldWriteCount = 0;
}

async function assertSessionWindow(policy) {
  if (!sessionStartedAt) {
    sessionStartedAt = Date.now();
    return;
  }

  const elapsedSeconds = (Date.now() - sessionStartedAt) / 1000;
  if (elapsedSeconds > policy.maxSessionSeconds) {
    await closeSession();
    throw new Error(`Browser session exceeded ${policy.maxSessionSeconds} seconds. Restart the worker.`);
  }
}

function validateTargetUrl(rawUrl, policy) {
  const targetUrl = new URL(rawUrl);

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new Error(`Unsupported URL scheme: ${targetUrl.protocol}`);
  }

  const host = targetUrl.hostname.toLowerCase();

  if (isBuiltInDeniedHost(host)) {
    throw new Error(`Denied host: ${host}`);
  }

  if (policy.deniedHosts.some(pattern => hostMatches(host, pattern))) {
    throw new Error(`Denied host: ${host}`);
  }

  if (policy.allowedHosts.length > 0 && !policy.allowedHosts.some(pattern => hostMatches(host, pattern))) {
    throw new Error(`Host not allowed: ${host}`);
  }

  return targetUrl;
}

function normalizeJobUrl(rawUrl) {
  const targetUrl = new URL(String(rawUrl || '').trim());

  for (const key of Array.from(targetUrl.searchParams.keys())) {
    if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
      targetUrl.searchParams.delete(key);
    }
  }

  targetUrl.hash = '';
  return targetUrl;
}

function validateJobBoardUrl(rawUrl, policy) {
  const targetUrl = normalizeJobUrl(rawUrl);
  const host = targetUrl.hostname.toLowerCase();

  validateTargetUrl(targetUrl.toString(), policy);

  if (!Array.from(JOB_BOARD_HOSTS).some(pattern => hostMatches(host, pattern))) {
    throw new Error(`Host is not an approved job board: ${host}`);
  }

  return targetUrl;
}

function describePageType(targetUrl) {
  const host = targetUrl.hostname.toLowerCase();
  if (hostMatches(host, 'job-boards.greenhouse.io') || hostMatches(host, 'boards.greenhouse.io')) {
    return 'greenhouse-job';
  }

  return 'job-board';
}

async function ensureNotChallenge(target) {
  const text = await target.evaluate(() => {
    const title = document.title || '';
    const body = document.body?.innerText || '';
    return `${title}\n${body}`.slice(0, 4000);
  });

  if (isChallengeText(text)) {
    throw new Error('CAPTCHA, 2FA, or a security challenge was detected. Pause and continue manually.');
  }
}

async function ensurePage() {
  const policy = getPolicy();
  await assertSessionWindow(policy);

  if (!browser) {
    browser = await chromium.launch({ headless: policy.headless });
  }
  if (!page) {
    page = await browser.newPage();
  }
  return page;
}

async function snapshotFields(target) {
  return target.locator('input, textarea, select').evaluateAll(nodes => nodes.map((node, index) => ({
    index,
    tag: node.tagName.toLowerCase(),
    type: node.getAttribute('type') || '',
    name: node.getAttribute('name') || '',
    id: node.getAttribute('id') || '',
    placeholder: node.getAttribute('placeholder') || '',
    ariaLabel: node.getAttribute('aria-label') || '',
    required: node.hasAttribute('required'),
    visible: (() => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0;
    })(),
    enabled: !node.disabled,
    readOnly: Boolean(node.readOnly),
    safeEditable: node.tagName.toLowerCase() === 'textarea' || node.tagName.toLowerCase() === 'select' || (node.tagName.toLowerCase() === 'input' && !['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset'].includes(String(node.getAttribute('type') || '').toLowerCase())),
    blockedReason: (() => {
      const tag = node.tagName.toLowerCase();
      const type = String(node.getAttribute('type') || '').toLowerCase();
      if (!['input', 'textarea', 'select'].includes(tag)) {
        return `Unsupported field tag: ${tag}`;
      }
      if (tag === 'input' && ['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset'].includes(type)) {
        return `Unsupported field type: ${type || '(default)'}`;
      }
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0) {
        return 'Field is not visible';
      }
      if (node.disabled) {
        return 'Field is disabled';
      }
      if (node.readOnly) {
        return 'Field is read-only';
      }
      return '';
    })(),
    value: node.value || ''
  })));
}

async function writeField(locator, value) {
  const tagName = await locator.evaluate(node => node.tagName.toLowerCase());
  if (tagName === 'select') {
    await locator.selectOption(String(value ?? ''));
    return;
  }

  await locator.fill(String(value ?? ''));
}

function authorizeBrowserWorkerRequest(req, res) {
  const configuredToken = parseBrowserWorkerToken();
  if (!configuredToken || req.path === '/healthz') {
    return true;
  }

  const auth = String(req.headers.authorization || '');
  const presentedToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (presentedToken === configuredToken) {
    return true;
  }

  res.status(401).json({ ok: false, error: 'Unauthorized' });
  return false;
}

function isSafeFieldSnapshot(field) {
  return Boolean(
    field &&
      field.safeEditable &&
      field.visible &&
      field.enabled &&
      !field.readOnly &&
      !field.blockedReason
  );
}

function getRequestedFieldIndex(item) {
  if (Number.isInteger(item?.index) && item.index >= 0) {
    return item.index;
  }

  return null;
}

async function resolveRequestedFieldLocator(target, item, fields) {
  const index = getRequestedFieldIndex(item);
  if (index !== null) {
    const field = fields[index];
    if (!field) {
      throw new Error(`Field index ${index} is out of range.`);
    }

    if (!isSafeFieldSnapshot(field)) {
      throw new Error(field.blockedReason || `Field index ${index} is not a safe editable field.`);
    }

    return target.locator('input, textarea, select').nth(index);
  }

  if (typeof item?.selector === 'string' && item.selector.trim()) {
    return describeSelectorField(target, item.selector.trim());
  }

  throw new Error('Each field must include either an index from the inspected field list or a selector.');
}

async function describeSelectorField(target, selector) {
  const locator = target.locator(selector);
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`Selector must resolve to exactly one field. Found ${count}.`);
  }

  const field = await locator.evaluate(node => {
    const tag = node.tagName.toLowerCase();
    const type = node.getAttribute('type') || '';
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0;
    const enabled = !node.disabled;
    const readOnly = Boolean(node.readOnly);
    const safeEditable = tag === 'textarea' || tag === 'select' || (tag === 'input' && !['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset'].includes(String(type).toLowerCase()));
    const blockedReason = !['input', 'textarea', 'select'].includes(tag)
      ? `Unsupported field tag: ${tag}`
      : tag === 'input' && ['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset'].includes(String(type).toLowerCase())
        ? `Unsupported field type: ${type || '(default)'}`
        : !visible
          ? 'Field is not visible'
          : !enabled
            ? 'Field is disabled'
            : readOnly
              ? 'Field is read-only'
              : '';

    return {
      tag,
      type,
      name: node.getAttribute('name') || '',
      id: node.getAttribute('id') || '',
      placeholder: node.getAttribute('placeholder') || '',
      ariaLabel: node.getAttribute('aria-label') || '',
      required: node.hasAttribute('required'),
      visible,
      enabled,
      readOnly,
      safeEditable,
      blockedReason,
      value: node.value || ''
    };
  });

  if (!isSafeFieldSnapshot(field)) {
    throw new Error(field.blockedReason || 'Selector did not resolve to a safe editable field.');
  }

  return locator;
}

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    service: 'network-mcp',
    browserVisible: String(process.env.NETWORK_MCP_HEADLESS || 'false').toLowerCase() !== 'true'
  });
});

app.use((req, res, next) => {
  if (req.path === '/healthz') {
    return next();
  }

  if (!authorizeBrowserWorkerRequest(req, res)) {
    return;
  }

  return next();
});

app.post('/open', async (req, res) => {
  try {
    const policy = getPolicy();
    const target = await ensurePage();
    const requestedUrl = String(req.body?.url || '').trim();
    const rawTargetUrl = validateTargetUrl(requestedUrl, policy);
    const isJobBoardUrl = Array.from(JOB_BOARD_HOSTS).some(pattern => hostMatches(rawTargetUrl.hostname.toLowerCase(), pattern));
    const targetUrl = isJobBoardUrl ? validateJobBoardUrl(requestedUrl, policy) : rawTargetUrl;

    if (pageVisitCount >= policy.maxPageVisits) {
      throw new Error(`Page visit limit reached (${policy.maxPageVisits}). Restart the worker.`);
    }

    await target.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded' });
    pageVisitCount += 1;
    await ensureNotChallenge(target);
    const response = { ok: true, url: target.url(), title: await target.title() };

    if (isJobBoardUrl) {
      response.normalizedUrl = targetUrl.toString();
      response.pageType = describePageType(targetUrl);
    }

    res.json(response);
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.post('/open-job', async (req, res) => {
  try {
    const policy = getPolicy();
    const target = await ensurePage();
    const requestedUrl = String(req.body?.url || '').trim();
    const normalizedUrl = validateJobBoardUrl(requestedUrl, policy);

    if (pageVisitCount >= policy.maxPageVisits) {
      throw new Error(`Page visit limit reached (${policy.maxPageVisits}). Restart the worker.`);
    }

    await target.goto(normalizedUrl.toString(), { waitUntil: 'domcontentloaded' });
    pageVisitCount += 1;
    await ensureNotChallenge(target);
    res.json({
      ok: true,
      url: target.url(),
      normalizedUrl: normalizedUrl.toString(),
      title: await target.title(),
      pageType: describePageType(normalizedUrl)
    });
  } catch (error) {
    res.status(409).json({ ok: false, errorType: 'OPEN_JOB_FAILED', error: error.message });
  }
});

app.post('/inspect', async (_req, res) => {
  try {
    const target = await ensurePage();
    await ensureNotChallenge(target);
    const fields = await snapshotFields(target);
    res.json({
      ok: true,
      url: target.url(),
      title: await target.title(),
      fields
    });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.post('/extract-form', async (_req, res) => {
  try {
    const target = await ensurePage();
    await ensureNotChallenge(target);
    const fields = await snapshotFields(target);
    res.json({
      ok: true,
      url: target.url(),
      fields
    });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.post('/propose', async (req, res) => {
  try {
    const target = await ensurePage();
    await ensureNotChallenge(target);
    const requestedFields = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const proposals = requestedFields.map((field, index) => ({
      index,
      name: field?.name || field?.selector || field?.index || `field-${index}`,
      value: field?.value ?? '',
      reason: field?.reason || 'Provided for supervised review before fill'
    }));

    res.json({
      ok: true,
      url: target.url(),
      title: await target.title(),
      proposals
    });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.post('/fill-after-approval', async (req, res) => {
  try {
    const policy = getPolicy();
    const approved = req.body?.approved === true;
    const approvalText = String(req.body?.approvalText || '');
    if (policy.requireApprovalForFill && (!approved || approvalText !== 'APPLY')) {
      throw new Error('Explicit approvalText=APPLY is required for fill actions.');
    }

    const requestedFields = Array.isArray(req.body?.fields) ? req.body.fields : [];
    if (formFillCount >= policy.maxFormFills) {
      throw new Error(`Form fill limit reached (${policy.maxFormFills}). Restart the worker.`);
    }

    if (fieldWriteCount + requestedFields.length > policy.maxFieldWrites) {
      throw new Error(`Field write limit would be exceeded (${policy.maxFieldWrites}).`);
    }

    const target = await ensurePage();
    await ensureNotChallenge(target);
    const fields = await snapshotFields(target);

    const filled = [];
    for (const item of requestedFields) {
      const locator = await resolveRequestedFieldLocator(target, item, fields);
      await writeField(locator, item.value);
      filled.push(item.name || item.selector || item.index);
    }

    formFillCount += 1;
    fieldWriteCount += requestedFields.length;

    res.json({ ok: true, filled });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.post('/review-before-submit', async (_req, res) => {
  try {
    const target = await ensurePage();
    await ensureNotChallenge(target);
    const outputDir = path.join('var', 'browser');
    await mkdir(outputDir, { recursive: true });
    const screenshotPath = path.join(outputDir, `review-${Date.now()}.png`);
    await target.screenshot({ path: screenshotPath, fullPage: true });
    res.json({ ok: true, url: target.url(), screenshot: screenshotPath, message: 'Review manually before submit.' });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

const port = Number(process.env.PORT || process.env.NETWORK_MCP_WORKER_PORT || 8791);
app.listen(port, '127.0.0.1', () => console.log(`Network browser worker listening on http://127.0.0.1:${port}`));

