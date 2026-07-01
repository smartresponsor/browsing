import express from 'express';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir } from 'fs/promises';
import path from 'path';
import { promisify } from 'node:util';

const app = express();
app.use(express.json({ limit: '2mb' }));
const execFileAsync = promisify(execFile);

let browser;
let connectedBrowser;
let page;
let sessionStartedAt = null;
let pageVisitCount = 0;
let formFillCount = 0;
let fieldWriteCount = 0;
const SAFE_FIELD_TAGS = new Set(['input', 'textarea', 'select']);
const UNSAFE_INPUT_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset']);
const DEFAULT_WORKER_PORT = 8791;
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
const DEFAULT_BROWSER_CHANNEL = 'msedge';
const PLAYWRIGHT_BROWSER_CHANNELS = new Set(['chromium', 'chrome', 'msedge']);

function parseList(value) {
  return String(value || '')
    .split(/[,;\r\n]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

function parseBrowserWorkerToken() {
  return String(process.env.NETWORK_MCP_BROWSER_WORKER_TOKEN || '').trim();
}

function getManagedUserDataDir(policy = getPolicy()) {
  return path.resolve(path.isAbsolute(policy.userDataDir)
    ? policy.userDataDir
    : path.join(process.cwd(), policy.userDataDir));
}

function normalizeError(error) {
  if (!error) {
    return '';
  }

  return error instanceof Error ? error.message : String(error);
}

function normalizeBrowserChannel(value) {
  const browserChannel = String(value || DEFAULT_BROWSER_CHANNEL).trim().toLowerCase();
  if (browserChannel === 'edge') {
    return 'msedge';
  }

  if (!PLAYWRIGHT_BROWSER_CHANNELS.has(browserChannel)) {
    throw new Error(`Unsupported NETWORK_MCP_BROWSER_CHANNEL "${browserChannel}". Use chromium, chrome, or msedge.`);
  }

  return browserChannel;
}

function getBrowserMode(policy) {
  if (policy.externalVisibleChrome) {
    return 'external-browser-cdp';
  }

  return `playwright-${policy.browserChannel}`;
}

function getPolicy() {
  const headless = String(process.env.NETWORK_MCP_HEADLESS || 'false').toLowerCase() === 'true';
  const browserChannel = normalizeBrowserChannel(process.env.NETWORK_MCP_BROWSER_CHANNEL);

  return {
    headless,
    requireApprovalForFill: String(process.env.NETWORK_MCP_REQUIRE_APPROVAL_FOR_FILL || 'true').toLowerCase() !== 'false',
    requireApprovalForSubmit: String(process.env.NETWORK_MCP_REQUIRE_APPROVAL_FOR_SUBMIT || 'true').toLowerCase() !== 'false',
    submitEnabled: String(process.env.NETWORK_MCP_ENABLE_SUBMIT || 'false').toLowerCase() === 'true',
    maxSessionSeconds: Number(process.env.NETWORK_MCP_MAX_SESSION_SECONDS || 7200),
    maxPageVisits: Number(process.env.NETWORK_MCP_MAX_PAGE_VISITS || 100),
    maxFormFills: Number(process.env.NETWORK_MCP_MAX_FORM_FILLS || 20),
    maxFieldWrites: Number(process.env.NETWORK_MCP_MAX_FIELD_WRITES || 80),
    allowedHosts: parseList(process.env.NETWORK_MCP_ALLOWED_HOSTS),
    deniedHosts: parseList(process.env.NETWORK_MCP_DENIED_HOSTS),
    browserChannel,
    userDataDir: String(process.env.NETWORK_MCP_USER_DATA_DIR || path.join('var', 'browser', 'profile')).trim(),
    externalVisibleChrome: process.platform === 'win32' && !headless && String(process.env.NETWORK_MCP_EXTERNAL_VISIBLE_CHROME || 'false').toLowerCase() === 'true',
    remoteDebuggingPort: Number(process.env.NETWORK_MCP_REMOTE_DEBUGGING_PORT || 9223)
  };
}

function getStartupUrl() {
  const workerPort = Number(process.env.PORT || process.env.NETWORK_MCP_WORKER_PORT || DEFAULT_WORKER_PORT);
  return String(
    process.env.NETWORK_MCP_START_URL ||
      process.env.NETWORK_MCP_VISIBLE_CHROME_URL ||
      `http://127.0.0.1:${workerPort}/healthz`
  ).trim();
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

function isAllowedHostOverride(host, policy) {
  return policy.allowedHosts.some(pattern => hostMatches(host, pattern));
}

function isSafeEditableInputType(type) {
  return !UNSAFE_INPUT_TYPES.has(type);
}

function isChallengeText(text) {
  return /captcha|2fa|two-factor|security check|challenge|bot detection|verify you are human|access denied/i.test(text);
}

async function closeSession() {
  if (connectedBrowser) {
    if (typeof connectedBrowser.disconnect === 'function') {
      await Promise.resolve(connectedBrowser.disconnect()).catch(() => {});
    }
    connectedBrowser = undefined;
    browser = undefined;
    page = undefined;
  }

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

async function closeSessionWithTimeout(timeoutMs = 10000) {
  let timedOut = false;
  const timeout = new Promise(resolve => setTimeout(() => {
    timedOut = true;
    resolve({ ok: false, error: `Timed out while closing browser session after ${timeoutMs} ms.` });
  }, timeoutMs));

  const closed = closeSession()
    .then(() => ({ ok: true, error: null }))
    .catch(error => ({ ok: false, error: normalizeError(error) }));

  const result = await Promise.race([closed, timeout]);
  return { ...result, timedOut };
}

function buildBrowserRuntimeStatus(policy = getPolicy()) {
  const pages = browser ? browser.pages() : [];
  const activePage = page && !page.isClosed() ? page : null;
  return {
    policy: {
      headless: policy.headless,
      browserChannel: policy.browserChannel,
      browserMode: getBrowserMode(policy),
      userDataDir: getManagedUserDataDir(policy),
      maxSessionSeconds: policy.maxSessionSeconds,
      maxPageVisits: policy.maxPageVisits,
      maxFormFills: policy.maxFormFills,
      maxFieldWrites: policy.maxFieldWrites,
      externalVisibleChrome: policy.externalVisibleChrome,
      remoteDebuggingPort: policy.remoteDebuggingPort
    },
    session: {
      startedAt: sessionStartedAt ? new Date(sessionStartedAt).toISOString() : null,
      elapsedSeconds: sessionStartedAt ? Math.round((Date.now() - sessionStartedAt) / 1000) : null,
      pageVisitCount,
      formFillCount,
      fieldWriteCount
    },
    browser: {
      contextOpen: Boolean(browser),
      pageOpen: Boolean(activePage),
      pageCount: pages.length,
      currentUrl: activePage ? activePage.url() : null
    }
  };
}

async function getBrowserStatus() {
  const policy = getPolicy();
  const runtime = buildBrowserRuntimeStatus(policy);
  const managedProcesses = await listManagedBrowserProcesses(policy);
  const detectedVisibleWindow = Boolean(
    managedProcesses?.ok &&
      Array.isArray(managedProcesses.processes) &&
      managedProcesses.processes.some(item => Number(item.mainWindowHandle || 0) > 0 || String(item.mainWindowTitle || '').trim() !== '')
  );
  return {
    ok: true,
    service: 'network-mcp-browser-worker',
    configuredVisible: !policy.headless,
    detectedVisibleWindow,
    browserVisible: detectedVisibleWindow,
    runtime,
    managedProcesses
  };
}

async function restartBrowserSession({ force = false, reopen = true, reason = '' } = {}) {
  const policy = getPolicy();
  const before = await getBrowserStatus();
  const close = await closeSessionWithTimeout();
  const forced = force ? await killManagedBrowserProcesses(policy) : { attempted: false, killed: [] };
  let reopened = null;

  if (reopen) {
    await ensurePage();
    reopened = await getBrowserStatus();
  }

  return {
    ok: close.ok && (!force || forced.ok !== false),
    action: 'browser_restart',
    reason,
    force,
    reopen,
    before,
    close,
    forced,
    after: reopened ?? await getBrowserStatus()
  };
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

  if (isBuiltInDeniedHost(host) && !isAllowedHostOverride(host, policy)) {
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
    const userDataDir = getManagedUserDataDir(policy);

    await mkdir(userDataDir, { recursive: true });

    if (policy.externalVisibleChrome) {
      try {
        const externalRuntime = await connectExternalVisibleChrome(policy, userDataDir);
        connectedBrowser = externalRuntime.connectedBrowser;
        browser = externalRuntime.context;
      } catch (error) {
        connectedBrowser = undefined;
        throw new Error(`External browser CDP mode failed and fallback launch is disabled for visible browser mode. ${normalizeError(error)}`);
      }
    }

    if (!browser) {
      await killManagedBrowserProcesses(policy);

      const launchOptions = {
        headless: policy.headless,
        args: [
          '--new-window',
          '--start-maximized',
          '--window-position=80,80',
          '--window-size=1400,1000'
        ]
      };

      if (policy.browserChannel !== 'chromium') {
        launchOptions.channel = policy.browserChannel;
      }

      try {
        browser = await chromium.launchPersistentContext(userDataDir, launchOptions);
      } catch (error) {
        if (policy.browserChannel === 'chromium') {
          throw error;
        }

        throw new Error(`Failed to launch configured browser channel ${policy.browserChannel}. Set NETWORK_MCP_BROWSER_CHANNEL or NETWORK_MCP_BROWSER_EXECUTABLE explicitly. ${normalizeError(error)}`);
      }
    }
  }

  if (!page) {
    const existingPages = browser.pages();
    page = existingPages.length > 0 ? existingPages[0] : await browser.newPage();
    await page.bringToFront().catch(() => {});
    if (page.url() === 'about:blank') {
      await page.goto(getStartupUrl(), { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(error => {
        console.warn(`Startup page open failed. ${normalizeError(error)}`);
      });
    }
  }

  return page;
}

async function connectToExistingCdpEndpoint(endpoint) {
  const cdpBrowser = await chromium.connectOverCDP(endpoint);
  const context = cdpBrowser.contexts()[0] ?? await cdpBrowser.newContext();
  return { connectedBrowser: cdpBrowser, context };
}

async function connectExternalVisibleChrome(policy, userDataDir) {
  const endpoint = `http://127.0.0.1:${policy.remoteDebuggingPort}`;
  const existingRuntime = await connectToExistingCdpEndpoint(endpoint).catch(() => null);

  if (existingRuntime) {
    return existingRuntime;
  }

  const executablePath = await resolveExternalBrowserExecutable();
  let lastError = null;

  await launchExternalVisibleChrome(policy, userDataDir, executablePath, getStartupUrl());

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await connectToExistingCdpEndpoint(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Unable to connect to browser CDP endpoint ${endpoint}. ${normalizeError(lastError)}`);
}

async function launchExternalVisibleChrome(policy, userDataDir, executablePath, startupUrl) {
  const scriptPath = path.join(process.cwd(), 'var', 'run', `external-visible-browser-${process.pid}.ps1`);
  const script = `
param(
  [Parameter(Mandatory = $true)]
  [string]$ExecutablePath,
  [Parameter(Mandatory = $true)]
  [string]$UserDataDir,
  [Parameter(Mandatory = $true)]
  [int]$Port,
  [Parameter(Mandatory = $true)]
  [string]$StartupUrl
)
$ErrorActionPreference = 'Stop'
$arguments = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$UserDataDir",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-mode",
  "--new-window",
  "--start-maximized",
  "--window-position=80,80",
  "--window-size=1400,1000",
  $StartupUrl
)
$commandLine = 'start "" "' + $ExecutablePath + '" ' + (($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
# cmd launcher disabled; shortcut launcher below is the active path.
$shortcutPath = Join-Path ([System.IO.Path]::GetDirectoryName($UserDataDir)) 'network-mcp-visible-browser.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $ExecutablePath
$shortcut.Arguments = (($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
$shortcut.WindowStyle = 3
$shortcut.Save()
Invoke-Item $shortcutPath
`;

  const { writeFile: writeTextFile } = await import('node:fs/promises');
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await writeTextFile(scriptPath, script, 'utf8');
  await execFileAsync(resolvePowerShellExecutable(), [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ExecutablePath',
    executablePath,
    '-UserDataDir',
    userDataDir,
    '-Port',
    String(policy.remoteDebuggingPort),
    '-StartupUrl',
    startupUrl
  ], { timeout: 15000, maxBuffer: 1024 * 1024 });
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function resolveExternalBrowserExecutable() {
  const override = String(process.env.NETWORK_MCP_BROWSER_EXECUTABLE || '').trim();
  if (override) {
    if (await fileExists(override)) {
      return override;
    }

    throw new Error(`Configured NETWORK_MCP_BROWSER_EXECUTABLE does not exist: ${override}`);
  }

  const candidates = [
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error('No supported browser executable was found. Set NETWORK_MCP_BROWSER_EXECUTABLE to chrome.exe or msedge.exe.');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

function isChatGptUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
  } catch (_error) {
    return false;
  }
}

function normalizeSnapshotText(value, maxLength = 8000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function hashChatGptSnapshotText(text) {
  return createHash('sha256').update(String(text || '').replace(/\r\n/g, '\n').trim(), 'utf8').digest('hex');
}

async function snapshotChatGptPage(target) {
  const currentUrl = target.url();
  if (!isChatGptUrl(currentUrl)) {
    return { ok: false, status: 'NOT_CHATGPT_PAGE', url: currentUrl, messages: [] };
  }

  const pageSnapshot = await target.evaluate(() => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
    const classifyRole = node => {
      const explicit = String(node.getAttribute('data-message-author-role') || '').toLowerCase();
      if (explicit === 'user' || explicit === 'assistant' || explicit === 'system') return explicit;
      const testId = String(node.getAttribute('data-testid') || '').toLowerCase();
      if (testId.includes('user')) return 'user';
      if (testId.includes('assistant')) return 'assistant';
      const aria = String(node.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('you')) return 'user';
      if (aria.includes('chatgpt')) return 'assistant';
      return 'unknown';
    };
    const selectors = ['[data-message-author-role]', '[data-testid^="conversation-turn"]', 'article'];
    const nodes = Array.from(new Set(selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)))));
    const messages = nodes
      .map((node, index) => ({ index, role: classifyRole(node), text: normalize(node.innerText || node.textContent || '') }))
      .filter(item => item.text.length > 0)
      .filter((item, index, items) => items.findIndex(other => other.role === item.role && other.text === item.text) === index)
      .slice(-200);
    return { title: document.title || '', messages };
  });

  const messages = pageSnapshot.messages.map((message, index) => ({
    ...message,
    index,
    hash: hashChatGptSnapshotText(message.text),
  }));
  const assistantMessages = messages.filter(message => message.role === 'assistant');
  const latestAssistant = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : null;
  return {
    ok: true,
    status: latestAssistant ? 'ASSISTANT_MESSAGE_AVAILABLE' : 'NO_ASSISTANT_MESSAGE',
    url: currentUrl,
    title: normalizeSnapshotText(pageSnapshot.title, 500),
    messageCount: messages.length,
    latestAssistant,
    messages,
  };
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
    labelText: (() => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
      const id = node.getAttribute('id') || '';
      const explicit = id ? document.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]') : null;
      const wrapping = node.closest('label');
      const labelledBy = String(node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(item => document.getElementById(item)).filter(Boolean).map(element => normalize(element.innerText || element.textContent || '')).join(' ');
      return normalize(labelledBy || explicit?.innerText || explicit?.textContent || wrapping?.innerText || wrapping?.textContent || '');
    })(),
    contextText: (() => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
      const container = node.closest('fieldset, li, tr, .question, .form-group, .form-row, .field, .field-wrapper, .formField, .questionWrapper, .questionContainer, section, article, div');
      if (!container) {
        return '';
      }

      return normalize(container.innerText || container.textContent || '');
    })(),
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
  const policy = getPolicy();
  res.json({
    ok: true,
    service: 'network-mcp',
    configuredVisible: String(process.env.NETWORK_MCP_HEADLESS || 'false').toLowerCase() !== 'true',
    browserVisible: String(process.env.NETWORK_MCP_HEADLESS || 'false').toLowerCase() !== 'true',
    browserChannel: policy.browserChannel,
    browserMode: getBrowserMode(policy),
    persistentProfile: true,
    userDataDirConfigured: Boolean(String(process.env.NETWORK_MCP_USER_DATA_DIR || path.join('var', 'browser', 'profile')).trim()),
    currentUrl: page && !page.isClosed() ? page.url() : null
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

app.post('/browser-status', async (_req, res) => {
  try {
    res.json(await getBrowserStatus());
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/browser-restart', async (req, res) => {
  try {
    const force = req.body?.force === true;
    const reopen = req.body?.reopen !== false;
    const reason = String(req.body?.reason || '').slice(0, 200);
    res.json(await restartBrowserSession({ force, reopen, reason }));
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/browser-kill', async (req, res) => {
  try {
    const policy = getPolicy();
    const reason = String(req.body?.reason || '').slice(0, 200);
    const before = await getBrowserStatus();
    const close = await closeSessionWithTimeout();
    const forced = await killManagedBrowserProcesses(policy);
    res.json({
      ok: close.ok && forced.ok !== false,
      action: 'browser_kill',
      reason,
      before,
      close,
      forced,
      after: await getBrowserStatus()
    });
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/open-fresh', async (req, res) => {
  try {
    const policy = getPolicy();
    const requestedUrl = String(req.body?.url || '').trim();
    const force = req.body?.force === true;
    const reason = String(req.body?.reason || '').slice(0, 200);
    const rawTargetUrl = validateTargetUrl(requestedUrl, policy);
    const isJobBoardUrl = Array.from(JOB_BOARD_HOSTS).some(pattern => hostMatches(rawTargetUrl.hostname.toLowerCase(), pattern));
    const targetUrl = isJobBoardUrl ? validateJobBoardUrl(requestedUrl, policy) : rawTargetUrl;

    const restart = await restartBrowserSession({ force, reopen: false, reason: reason || 'open_fresh' });
    const target = await ensurePage();

    await target.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded' });
    await target.bringToFront().catch(() => {});
    pageVisitCount += 1;
    await ensureNotChallenge(target);
    const response = {
      ok: true,
      action: 'open_fresh',
      url: target.url(),
      restart
    };

    if (isJobBoardUrl) {
      response.normalizedUrl = targetUrl.toString();
      response.pageType = describePageType(targetUrl);
    }

    res.json(response);
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
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
    await target.bringToFront().catch(() => {});
    pageVisitCount += 1;
    await ensureNotChallenge(target);
    const response = { ok: true, url: target.url() };

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
    await target.bringToFront().catch(() => {});
    pageVisitCount += 1;
    await ensureNotChallenge(target);
    res.json({
      ok: true,
      url: target.url(),
      normalizedUrl: normalizedUrl.toString(),
      pageType: describePageType(normalizedUrl)
    });
  } catch (error) {
    res.status(409).json({ ok: false, errorType: 'OPEN_JOB_FAILED', error: error.message });
  }
});

app.post('/chatgpt-snapshot', async (_req, res) => {
  try {
    const target = await ensurePage();
    await target.bringToFront().catch(() => {});
    res.json(await snapshotChatGptPage(target));
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
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

app.post('/click', async (req, res) => {
  try {
    const target = await ensurePage();
    await ensureNotChallenge(target);
    const text = String(req.body?.text || '').trim();
    const selector = String(req.body?.selector || '').trim();
    const nth = Number.isInteger(req.body?.nth) && req.body.nth >= 0 ? req.body.nth : 0;
    if (!text && !selector) {
      throw new Error('Either text or selector is required for click.');
    }
    if (/submit|final|delete|withdraw|payment|purchase|confirm/i.test(text)) {
      throw new Error('Final submit or destructive clicks are not allowed through network.click.');
    }
    let locator = selector ? target.locator(selector) : target.getByRole('button', { name: text, exact: true });
    if (!selector && await locator.count() === 0) {
      locator = target.getByRole('link', { name: text, exact: true });
    }
    if (!selector && await locator.count() === 0) {
      locator = target.getByText(text, { exact: true });
    }
    const count = await locator.count();
    if (count <= nth) {
      throw new Error(`Click target not found. Matches: ${count}. Requested index: ${nth}.`);
    }
    await locator.nth(nth).click();
    await target.bringToFront().catch(() => {});
    await target.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await ensureNotChallenge(target);
    res.json({ ok: true, url: target.url(), title: await target.title(), clicked: selector || text, nth });
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

async function listManagedBrowserProcesses(policy = getPolicy()) {
  if (process.platform !== 'win32') {
    return { ok: true, platform: process.platform, supported: false, processes: [] };
  }

  const userDataDir = getManagedUserDataDir(policy);
  const scriptPath = path.join(process.cwd(), 'var', 'run', `browser-process-list-${process.pid}.ps1`);
  const script = `
param(
  [Parameter(Mandatory = $true)]
  [string]$UserDataDir
)
$ErrorActionPreference = 'Stop'
$windowApi = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class NetworkMcpWindowApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
Add-Type -TypeDefinition $windowApi -ErrorAction SilentlyContinue
function Get-WindowInfoForProcessId {
  param([int]$ProcessId)
  $result = [PSCustomObject]@{ MainWindowHandle = 0; MainWindowTitle = '' }
  $callback = [NetworkMcpWindowApi+EnumWindowsProc]{
    param([IntPtr]$handle, [IntPtr]$lParam)
    [uint32]$windowProcessId = 0
    [NetworkMcpWindowApi]::GetWindowThreadProcessId($handle, [ref]$windowProcessId) | Out-Null
    if ($windowProcessId -eq [uint32]$ProcessId -and [NetworkMcpWindowApi]::IsWindowVisible($handle)) {
      $length = [NetworkMcpWindowApi]::GetWindowTextLength($handle)
      $builder = New-Object System.Text.StringBuilder ([Math]::Max($length + 1, 256))
      [NetworkMcpWindowApi]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null
      $title = $builder.ToString()
      if ($title.Trim() -ne '') {
        $result.MainWindowHandle = $handle.ToInt64()
        $result.MainWindowTitle = $title
        return $false
      }
    }
    return $true
  }
  [NetworkMcpWindowApi]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
  return $result
}
$full = [System.IO.Path]::GetFullPath($UserDataDir).TrimEnd('\\')
$names = @('chrome.exe', 'msedge.exe', 'chromium.exe')
$items = Get-CimInstance Win32_Process | Where-Object {
  $names -contains $_.Name -and $_.CommandLine -and (
    $_.CommandLine -like ('*--user-data-dir=' + $full + '*') -or
    $_.CommandLine -like ('*--user-data-dir="' + $full + '"*') -or
    $_.CommandLine -like ('*' + $full + '*')
  )
} | ForEach-Object {
  $process = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
  $window = if ($process) { Get-WindowInfoForProcessId -ProcessId $_.ProcessId } else { $null }
  [PSCustomObject]@{
    ProcessId = $_.ProcessId
    Name = $_.Name
    ExecutablePath = $_.ExecutablePath
    CommandLine = $_.CommandLine
    MainWindowHandle = if ($window -and $window.MainWindowHandle) { [int64]$window.MainWindowHandle } elseif ($process) { [int64]$process.MainWindowHandle } else { 0 }
    MainWindowTitle = if ($window -and $window.MainWindowTitle) { [string]$window.MainWindowTitle } elseif ($process) { [string]$process.MainWindowTitle } else { '' }
  }
}
$items | ConvertTo-Json -Depth 4
`;

  try {
    const { writeFile: writeTextFile } = await import('node:fs/promises');
    await mkdir(path.dirname(scriptPath), { recursive: true });
    await writeTextFile(scriptPath, script, 'utf8');
    const { stdout } = await execFileAsync(resolvePowerShellExecutable(), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-UserDataDir', userDataDir], { timeout: 15000, maxBuffer: 1024 * 1024 });
    const parsed = parsePowerShellJson(stdout);
    return { ok: true, platform: process.platform, supported: true, userDataDir, processes: Array.isArray(parsed) ? parsed.map(sanitizeProcessInfo) : parsed ? [sanitizeProcessInfo(parsed)] : [] };
  } catch (error) {
    return { ok: false, platform: process.platform, supported: true, userDataDir, error: normalizeError(error), processes: [] };
  }
}

async function killManagedBrowserProcesses(policy = getPolicy()) {
  const listed = await listManagedBrowserProcesses(policy);
  const killed = [];
  const failed = [];

  for (const item of listed.processes || []) {
    try {
      process.kill(item.processId);
      killed.push(item);
    } catch (error) {
      failed.push({ ...item, error: normalizeError(error) });
    }
  }

  return { ok: listed.ok && failed.length === 0, attempted: true, listed, killed, failed };
}

function resolvePowerShellExecutable() {
  return process.env.PWSH || process.env.POWERSHELL || 'pwsh';
}

function parsePowerShellJson(stdout) {
  const raw = String(stdout || '').trim();
  return raw ? JSON.parse(raw) : null;
}

function sanitizeProcessInfo(item) {
  return {
    processId: Number(item.ProcessId),
    name: String(item.Name || ''),
    executablePath: String(item.ExecutablePath || ''),
    commandLine: String(item.CommandLine || ''),
    mainWindowHandle: Number(item.MainWindowHandle || 0),
    mainWindowTitle: String(item.MainWindowTitle || '')
  };
}

const port = Number(process.env.PORT || process.env.NETWORK_MCP_WORKER_PORT || DEFAULT_WORKER_PORT);
app.listen(port, '127.0.0.1', () => {
  console.log(`Network browser worker listening on http://127.0.0.1:${port}`);
  ensurePage().catch(error => {
    console.warn(`Startup browser open failed. ${normalizeError(error)}`);
  });
});
