import express from 'express';
import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'node:util';
import {
  DEFAULT_WORKER_PORT,
  JOB_BOARD_HOSTS,
  SAFE_FIELD_TAGS,
  TRACKING_QUERY_PARAMS,
  hostMatches,
  isAllowedHostOverride,
  isBuiltInDeniedHost,
  isChallengeText,
  isJobBoardHost,
  isSafeEditableInputType,
  normalizeBrowserChannel,
  parseList
} from './browser-policy.js';

import {
  buildChatGptHomeCleanupPlan,
  cleanupChatGptHomeTargets,
  compactRawCdpTarget,
  evaluateRawCdpTarget,
  listRawCdpTargets,
  verifyChatGptHomeTarget
} from './cdp-target-inventory.js';
import {
  assertExpectedRevisions,
  buildRevisionEnvelope,
  hashStableJson
} from './revision-contract.js';
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
let lastExternalAttachError = '';
function parseBrowserWorkerToken() {
  return String(process.env.NETWORK_MCP_BROWSER_WORKER_TOKEN || '').trim();
}

function getSharedBrowserRoot() {
  return path.resolve(String(process.env.NETWORK_MCP_SHARED_BROWSER_ROOT || path.join(process.cwd(), '..', 'mcp', 'browser')).trim());
}

function getDefaultUserDataDir() {
  return path.join(getSharedBrowserRoot(), 'profile');
}

function getSharedBrowserRuntimeFile(policy = getPolicy()) {
  return path.join(policy.sharedBrowserRoot, 'run', 'browser-runtime.json');
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

function getBrowserMode(policy) {
  if (policy.externalVisibleBrowser) {
    return 'external-browser-cdp';
  }

  return `playwright-${policy.browserChannel}`;
}

async function writeReviewScreenshot(target, prefix = 'review') {
  const outputDir = path.join('var', 'browser');
  await mkdir(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, `${prefix}-${Date.now()}.png`);
  await target.screenshot({ path: screenshotPath, fullPage: true });
  return screenshotPath;
}

async function getDevToolsStatus(policy = getPolicy()) {
  if (!policy.externalVisibleChrome) {
    return { ok: true, enabled: false, reason: 'External visible Chrome mode is disabled.' };
  }

  const endpoint = `http://127.0.0.1:${policy.remoteDebuggingPort}/json/version`;
  try {
    const response = await fetch(endpoint);
    const bodyText = await response.text();
    let parsed = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch (_error) {
      parsed = null;
    }
    const userAgent = parsed?.['User-Agent'] || '';
    const product = userAgent.includes('Edg/') ? 'msedge' : userAgent.includes('Chrome/') ? 'chrome' : '';
    return { ok: response.ok, enabled: true, endpoint, status: response.status, product, userAgent, body: bodyText };
  } catch (error) {
    return { ok: false, enabled: true, endpoint, error: normalizeError(error) };
  }
}

function getPolicy() {
  const headless = String(process.env.NETWORK_MCP_HEADLESS || 'false').toLowerCase() === 'true';
  const browserChannel = normalizeBrowserChannel(process.env.NETWORK_MCP_BROWSER_CHANNEL);
  const externalVisibleBrowser = process.platform === 'win32' && !headless && String(
    process.env.NETWORK_MCP_EXTERNAL_VISIBLE_BROWSER ??
      process.env.NETWORK_MCP_EXTERNAL_VISIBLE_CHROME ??
      'true'
  ).toLowerCase() === 'true';

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
    sharedBrowserRoot: getSharedBrowserRoot(),
    userDataDir: String(process.env.NETWORK_MCP_USER_DATA_DIR || getDefaultUserDataDir()).trim(),
    externalVisibleBrowser,
    externalVisibleChrome: externalVisibleBrowser,
    remoteDebuggingPort: Number(process.env.NETWORK_MCP_REMOTE_DEBUGGING_PORT || 9223),
    externalAttachTimeoutMs: Number(process.env.NETWORK_MCP_EXTERNAL_ATTACH_TIMEOUT_MS || 5000)
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

async function closeSession() {
  if (connectedBrowser) {
    await connectedBrowser.close().catch(() => {});
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
      externalVisibleBrowser: policy.externalVisibleBrowser,
      externalVisibleChrome: policy.externalVisibleChrome,
      remoteDebuggingPort: policy.remoteDebuggingPort,
      externalAttachTimeoutMs: policy.externalAttachTimeoutMs
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
      activePageIndex: activePage ? pages.findIndex(item => item === activePage) : null,
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
    lastExternalAttachError,
    runtime,
    managedProcesses
  };
}

async function getFullHealthStatus() {
  const policy = getPolicy();
  const browserStatus = await getBrowserStatus().catch(error => ({ ok: false, error: normalizeError(error) }));
  const devTools = await getDevToolsStatus(policy);
  const activePage = page && !page.isClosed() ? page : null;
  return {
    ok: Boolean(browserStatus.ok) && (devTools.enabled ? devTools.ok : true),
    service: 'network-mcp-browser-worker',
    worker: { ok: true, pid: process.pid, uptimeSeconds: Math.round(process.uptime()), port },
    browser: browserStatus,
    devTools,
    target: activePage ? { ok: true, url: activePage.url(), closed: activePage.isClosed() } : { ok: false, reason: 'No active page bound.' },
    profile: { userDataDir: getManagedUserDataDir(policy), externalVisibleChrome: policy.externalVisibleChrome, configuredBrowserChannel: policy.browserChannel },
    actualBrowser: devTools.enabled ? { product: devTools.product || '', userAgent: devTools.userAgent || '' } : null
  };
}

async function getSharedBrowserRuntimeStatus() {
  const policy = getPolicy();
  const runtimeFile = getSharedBrowserRuntimeFile(policy);
  let registry = null;
  let registryError = '';

  try {
    registry = JSON.parse(await readFile(runtimeFile, 'utf8'));
  } catch (error) {
    registryError = normalizeError(error);
  }

  const devTools = await getDevToolsStatus(policy);
  const attached = Boolean(devTools.ok && browser && browser.pages().length > 0);
  return {
    ok: Boolean(registry?.ok || attached),
    service: 'network-mcp-browser-worker',
    runtimeFile,
    registry: registry || null,
    registryError: registry ? null : registryError,
    live: {
      attached,
      pageCount: browser ? browser.pages().length : 0,
      activeUrl: page && !page.isClosed() ? page.url() : null,
      cdp: devTools
    }
  };
}

function buildConnectorSettingsUrl(connectorId = '') {
  return connectorId
    ? `https://chatgpt.com/#settings/Connectors?connector=${encodeURIComponent(connectorId)}`
    : 'https://chatgpt.com/#settings/Apps';
}

function planNetworkConnectorRefresh({ connectorName, connectorId, timeoutMs } = {}) {
  const name = String(connectorName || process.env.NETWORK_MCP_CHATGPT_CONNECTOR_NAME || 'network-mcp');
  const id = String(connectorId || process.env.NETWORK_MCP_CHATGPT_CONNECTOR_ID || '');
  const boundedTimeoutMs = Number.isInteger(timeoutMs) ? Math.min(Math.max(timeoutMs, 5000), 120000) : 90000;
  return {
    ok: true,
    status: 'NETWORK_CONNECTOR_REFRESH_PLAN_READY',
    connectorName: name,
    connectorId: id || null,
    targetUrl: buildConnectorSettingsUrl(id),
    executeTool: 'network.surface_execute',
    executeRequires: { confirmSync: true, connectorName: name, connectorId: id || undefined },
    timeoutMs: boundedTimeoutMs,
    policy: {
      browserMutation: false,
      connectorRefresh: false,
      writesInput: false,
      submitsInput: false,
      closesTabs: false
    }
  };
}

async function createRawCdpTarget(policy, targetUrl, timeoutMs) {
  const endpoint = `http://127.0.0.1:${policy.remoteDebuggingPort}`;
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(targetUrl)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(Math.max(250, timeoutMs))
  });
  if (!response.ok) throw new Error(`DevTools target create failed with HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function resolveConnectorRefreshTarget(policy, targetUrl, connectorId, timeoutMs) {
  const inventory = await listRawCdpTargets(policy);
  const targets = inventory.targets.filter(target => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string');
  const existing = targets.find(target => connectorId && String(target.url || '').includes(connectorId))
    || targets.find(target => String(target.url || '').includes('#settings/Connectors'))
    || targets.find(target => String(target.url || '').includes('#settings/Apps'));
  if (existing) return { ...existing, reused: true };
  const created = await createRawCdpTarget(policy, targetUrl, timeoutMs);
  const deadline = Date.now() + Math.min(timeoutMs, 15000);
  while (Date.now() <= deadline) {
    const refreshed = await listRawCdpTargets(policy);
    const createdTarget = refreshed.targets.find(target => target.id === created.id && target.webSocketDebuggerUrl);
    if (createdTarget) return { ...createdTarget, reused: false };
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return { ...created, reused: false };
}

function buildNetworkConnectorRefreshExpression(connectorName, connectorId, targetUrl) {
  return `(async () => { const connectorName = ${JSON.stringify(connectorName)}; const connectorId = ${JSON.stringify(connectorId)}; const targetUrl = ${JSON.stringify(targetUrl)}; const deadline = Date.now() + 60000; const events = []; const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim(); const visible = (node) => { if (!node || !(node instanceof Element)) return false; const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0; }; const textOf = (node) => clean([node.getAttribute?.('aria-label'), node.getAttribute?.('title'), node.getAttribute?.('data-testid'), node.innerText, node.textContent].filter(Boolean).join(' ')); const nodes = () => Array.from(document.querySelectorAll('button,a,[role="button"],[role="menuitem"],[aria-label],[data-testid],div,span,p,h1,h2,h3')).filter(visible); const bodyText = () => clean(document.body?.innerText || document.documentElement?.innerText || ''); const actionNodes = () => nodes().filter((node) => node.matches?.('button,a,[role="button"],[role="menuitem"]') || (getComputedStyle(node).cursor === 'pointer' && node.getBoundingClientRect().width <= 400)); const findAction = (patterns) => actionNodes().find((node) => patterns.some((pattern) => pattern.test(textOf(node)))); const waitFor = async (probe, label) => { while (Date.now() <= deadline) { const value = probe(); if (value) return value; await sleep(250); } events.push({ action: 'timeout', label, href: location.href }); return null; }; const click = async (node, label) => { node.scrollIntoView?.({ block: 'center', inline: 'center' }); await sleep(250); node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); node.dispatchEvent(new MouseEvent('click', { bubbles: true })); node.click?.(); events.push({ action: 'click', label, text: textOf(node).slice(0, 180), href: location.href, at: new Date().toISOString() }); await sleep(700); }; await waitFor(() => document.readyState === 'interactive' || document.readyState === 'complete', 'document-ready'); if (!location.href.includes('#settings') || (connectorId && !location.href.includes(connectorId))) { location.href = targetUrl; events.push({ action: 'navigate', targetUrl, href: location.href }); await sleep(1500); } const settingsReady = await waitFor(() => /Settings|General|Connectors|Apps|Applications/i.test(bodyText()), 'settings-ready'); if (!settingsReady) return { ok: false, status: 'SETTINGS_NOT_READY', connectorName, connectorId: connectorId || null, href: location.href, events, bodySample: bodyText().slice(0, 1200) }; const escaped = connectorName.replace(/[.*+?^$(){}|[\\]\\\\]/g, '\\\\$&'); const namePattern = new RegExp(escaped, 'i'); const connectorSeen = () => namePattern.test(bodyText()) || (connectorId && bodyText().includes(connectorId)) || (connectorId && location.href.includes(connectorId)); const ready = await waitFor(() => connectorSeen() && findAction([/^refresh$/i, /\\brefresh\\b/i]), 'refresh-ready'); if (!ready) return { ok: false, status: 'REFRESH_CONTROL_NOT_FOUND', connectorName, connectorId: connectorId || null, href: location.href, events, bodySample: bodyText().slice(0, 2000) }; await click(ready, 'refresh'); const result = await waitFor(() => { const text = bodyText(); const success = text.match(/.{0,80}(actions refreshed|refreshed).{0,120}/i)?.[0] || null; if (success) return { ok: true, status: 'ACTIONS_REFRESHED', message: clean(success) }; const failure = text.match(/.{0,80}(failed to refresh|error refreshing actions|something went wrong|could not refresh).{0,120}/i)?.[0] || null; if (failure) return { ok: false, status: 'ACTIONS_REFRESH_FAILED', message: clean(failure) }; return null; }, 'refresh-result'); const pageText = bodyText().slice(0, 20000); const networkToolsVisible = /network\./.test(pageText); if (!result && networkToolsVisible) return { ok: true, status: 'REFRESH_CLICKED_NETWORK_TOOLS_VISIBLE', connectorName, connectorId: connectorId || null, href: location.href, events, pageText }; if (!result) return { ok: false, status: 'REFRESH_CLICKED_RESULT_NOT_SEEN', connectorName, connectorId: connectorId || null, href: location.href, events, pageText }; return { ...result, connectorName, connectorId: connectorId || null, href: location.href, events, pageText }; })()`;
}

async function executeNetworkConnectorRefresh({ confirmRefresh = false, connectorName, connectorId, timeoutMs } = {}) {
  const plan = planNetworkConnectorRefresh({ connectorName, connectorId, timeoutMs });
  if (confirmRefresh !== true) {
    return { ok: false, status: 'CONFIRM_CONNECTOR_REFRESH_REQUIRED', willRefreshConnector: true, plan, policy: { browserMutation: true, connectorRefresh: true, requiresConfirmRefresh: true } };
  }
  const policy = getPolicy();
  const target = await resolveConnectorRefreshTarget(policy, plan.targetUrl, plan.connectorId || '', plan.timeoutMs);
  if (!target.webSocketDebuggerUrl) return { ok: false, status: 'CONNECTOR_REFRESH_TARGET_WEBSOCKET_MISSING', target, plan };
  const result = await evaluateRawCdpTarget(target, buildNetworkConnectorRefreshExpression(plan.connectorName, plan.connectorId || '', plan.targetUrl), Math.min(plan.timeoutMs, 120000));
  const pageText = typeof result?.pageText === 'string' ? result.pageText : '';
  const observedTools = [...new Set([...pageText.matchAll(/\bnetwork\.[A-Za-z0-9_.]+/g)].map(match => match[0]))].sort();
  return { ok: Boolean(result?.ok), status: result?.ok ? 'NETWORK_CONNECTOR_REFRESH_DONE' : String(result?.status || 'NETWORK_CONNECTOR_REFRESH_FAILED'), connectorName: plan.connectorName, connectorId: plan.connectorId, target: compactRawCdpTarget(target), refresh: result, observedSchema: { exposed: observedTools.length > 0, count: observedTools.length, tools: observedTools }, plan, policy: { browserMutation: true, connectorRefresh: true, requiresConfirmRefresh: true, writesInput: false, submitsInput: false, closesTabs: false } };
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
        lastExternalAttachError = '';
      } catch (error) {
        connectedBrowser = undefined;
        lastExternalAttachError = normalizeError(error);
        throw new Error(`Shared browser CDP attach failed. ${lastExternalAttachError}`);
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

        console.warn(`Failed to launch browser channel ${policy.browserChannel}; retrying with bundled Chromium. ${error.message}`);
        browser = await chromium.launchPersistentContext(userDataDir, {
          headless: policy.headless,
          args: [
            '--new-window',
            '--start-maximized',
            '--window-position=80,80',
            '--window-size=1400,1000'
          ]
        });
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

async function connectToExistingCdpEndpoint(endpoint, timeoutMs = 5000) {
  let connectEndpoint = endpoint;
  try {
    const versionResponse = await fetch(`${endpoint.replace(/\/$/, '')}/json/version`, {
      signal: AbortSignal.timeout(Math.max(250, timeoutMs))
    });
    const version = await versionResponse.json();
    if (typeof version.webSocketDebuggerUrl === 'string' && version.webSocketDebuggerUrl.trim()) {
      connectEndpoint = version.webSocketDebuggerUrl.trim();
    }
  } catch (_error) {
    connectEndpoint = endpoint;
  }

  const cdpBrowser = await chromium.connectOverCDP(connectEndpoint, { timeout: Math.max(250, timeoutMs) });
  const context = cdpBrowser.contexts()[0] ?? await cdpBrowser.newContext();
  return { connectedBrowser: cdpBrowser, context };
}

async function connectExternalVisibleChrome(policy, _userDataDir) {
  const endpoint = `http://127.0.0.1:${policy.remoteDebuggingPort}`;
  const timeoutMs = Number.isFinite(policy.externalAttachTimeoutMs) ? policy.externalAttachTimeoutMs : 5000;
  try {
    return await connectToExistingCdpEndpoint(endpoint, timeoutMs);
  } catch (error) {
    throw new Error(`Unable to attach to shared browser CDP endpoint ${endpoint} within ${timeoutMs} ms. ${normalizeError(error)}`);
  }
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

async function snapshotSubmitCandidates(target) {
  return target.locator('button, input[type="submit"], input[type="button"], a').evaluateAll(nodes => nodes.map((node, index) => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const tag = node.tagName.toLowerCase();
    const type = String(node.getAttribute('type') || '').toLowerCase();
    const text = normalize(node.innerText || node.textContent || node.getAttribute('value') || node.getAttribute('aria-label') || '');
    const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0;
    const isFinal = /submit|apply|send|confirm|finish|complete|delete|withdraw|purchase|payment/i.test(text) || type === 'submit';
    return {
      index,
      tag,
      type,
      text,
      name: node.getAttribute('name') || '',
      id: node.getAttribute('id') || '',
      ariaLabel: node.getAttribute('aria-label') || '',
      visible: isVisible,
      enabled: !node.disabled,
      finalCandidate: isFinal
    };
  })).then(items => items.filter(item => item.visible && item.enabled && item.text));
}

async function getPageTargetId(target) {
  let session;
  try {
    session = await target.context().newCDPSession(target);
    const info = await session.send('Target.getTargetInfo');
    const targetId = String(info?.targetInfo?.targetId || '').trim();
    if (targetId) {
      return targetId;
    }
  } catch (_error) {
    // Fall back to a deterministic page identity when CDP target info is unavailable.
  } finally {
    await session?.detach().catch(() => {});
  }

  return `fallback:${hashStableJson({
    url: target.url(),
    title: await target.title().catch(() => ''),
  })}`;
}

function expectedRevisionsFromBody(body) {
  return {
    targetId: body?.expectedTargetId,
    pageRevision: body?.expectedPageRevision,
    formRevision: body?.expectedFormRevision,
  };
}

function sendNetworkError(res, error, fallbackStatus = 'NETWORK_OPERATION_FAILED') {
  res.status(409).json({
    ok: false,
    status: typeof error?.networkStatus === 'string' ? error.networkStatus : fallbackStatus,
    error: normalizeError(error),
    evidence: error?.evidence && typeof error.evidence === 'object' ? error.evidence : undefined,
  });
}

async function capturePageArtifact(target, { screenshot = false, screenshotPrefix = 'capture' } = {}) {
  await ensureNotChallenge(target);
  const fields = await snapshotFields(target);
  const submitCandidates = await snapshotSubmitCandidates(target);
  const visibleText = await target.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16000));
  const url = target.url();
  const title = await target.title();
  const textHash = hashChatGptSnapshotText(visibleText);
  const targetId = await getPageTargetId(target);
  const revisions = buildRevisionEnvelope({ targetId, url, title, textHash, fields });
  const artifact = {
    ok: true,
    url,
    title,
    textHash,
    fields,
    ...revisions,
    submitCandidates
  };
  const reviewHash = hashStableJson({
    targetId: artifact.targetId,
    pageRevision: artifact.pageRevision,
    formRevision: artifact.formRevision,
    url: artifact.url,
    title: artifact.title,
    textHash: artifact.textHash,
    submitCandidates: artifact.submitCandidates
  });

  return {
    ...artifact,
    reviewHash,
    screenshot: screenshot ? await writeReviewScreenshot(target, screenshotPrefix) : null
  };
}

async function listBrowserTargets() {
  await ensurePage();
  const pages = browser ? browser.pages() : [];
  const targets = [];

  for (let index = 0; index < pages.length; index += 1) {
    const item = pages[index];
    targets.push({
      index,
      active: item === page,
      closed: item.isClosed(),
      url: item.isClosed() ? null : item.url(),
      title: item.isClosed() ? null : await item.title().catch(() => null)
    });
  }

  return { ok: true, activeIndex: targets.find(item => item.active)?.index ?? null, targets };
}

async function bindBrowserTarget({ index, url, urlContains } = {}) {
  await ensurePage();
  const pages = browser ? browser.pages() : [];
  let selected = null;

  if (Number.isInteger(index)) {
    selected = pages[index] ?? null;
  } else if (url) {
    selected = pages.find(item => !item.isClosed() && item.url() === String(url)) ?? null;
  } else if (urlContains) {
    selected = pages.find(item => !item.isClosed() && item.url().includes(String(urlContains))) ?? null;
  }

  if (!selected || selected.isClosed()) {
    throw new Error('Requested browser target was not found or is closed.');
  }

  page = selected;
  await page.bringToFront().catch(() => {});
  return { ok: true, bound: { index: pages.findIndex(item => item === page), url: page.url(), title: await page.title().catch(() => '') } };
}

async function waitForReadiness(target, { selector = '', state = 'domcontentloaded', timeoutMs = 15000, quietMs = 500 } = {}) {
  const startedAt = Date.now();
  if (state === 'selector-visible' || state === 'selector-attached') {
    if (!selector) {
      throw new Error(`selector is required for ${state}.`);
    }
    await target.locator(selector).first().waitFor({ state: state === 'selector-visible' ? 'visible' : 'attached', timeout: timeoutMs });
  } else if (state === 'mutation-quiet') {
    await target.evaluate(({ quietMs: browserQuietMs, timeoutMs: browserTimeoutMs }) => new Promise((resolve, reject) => {
      let timer = window.setTimeout(done, browserQuietMs);
      const fail = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error('Mutation quiet wait timed out.'));
      }, browserTimeoutMs);
      const observer = new MutationObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(done, browserQuietMs);
      });
      function done() {
        window.clearTimeout(fail);
        observer.disconnect();
        resolve(true);
      }
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    }), { quietMs, timeoutMs });
  } else {
    await target.waitForLoadState(state, { timeout: timeoutMs });
  }

  await ensureNotChallenge(target);
  return { ok: true, state, selector: selector || null, elapsedMs: Date.now() - startedAt, url: target.url(), title: await target.title() };
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

app.post('/health-full', async (_req, res) => {
  try {
    res.json(await getFullHealthStatus());
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/shared-browser-status', async (_req, res) => {
  try {
    res.json(await getSharedBrowserRuntimeStatus());
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/connector-sync-plan', async (req, res) => {
  try {
    res.json(planNetworkConnectorRefresh({ connectorName: req.body?.connectorName, connectorId: req.body?.connectorId, timeoutMs: req.body?.timeoutMs }));
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/connector-sync-execute', async (req, res) => {
  try {
    res.json(await executeNetworkConnectorRefresh({ confirmRefresh: req.body?.confirmRefresh === true || req.body?.confirmSync === true, connectorName: req.body?.connectorName, connectorId: req.body?.connectorId, timeoutMs: req.body?.timeoutMs }));
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/browser-cdp-targets', async (_req, res) => {
  try {
    res.json(await listRawCdpTargets(getPolicy()));
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/browser-cdp-verify-chatgpt-home', async (req, res) => {
  try {
    const inventory = await listRawCdpTargets(getPolicy());
    const timeoutMs = Number.isInteger(req.body?.timeoutMs) ? Math.min(Math.max(req.body.timeoutMs, 250), 10000) : 5000;
    const maxVerify = Number.isInteger(req.body?.maxVerify) ? Math.min(Math.max(req.body.maxVerify, 1), 50) : 10;
    const requestedIndex = Number.isInteger(req.body?.index) ? req.body.index : null;
    const requestedId = typeof req.body?.id === 'string' && req.body.id.trim() ? req.body.id.trim() : null;
    const candidates = inventory.targets
      .filter(target => target.classification.rawCleanupCandidate)
      .filter(target => requestedIndex === null || target.index === requestedIndex)
      .filter(target => requestedId === null || target.id === requestedId)
      .slice(0, maxVerify);
    const verified = [];
    for (const target of candidates) {
      verified.push(await verifyChatGptHomeTarget(target, timeoutMs));
    }
    res.json({
      ok: true,
      service: 'network-mcp-browser-worker',
      action: 'browser_cdp_verify_chatgpt_home',
      requested: { index: requestedIndex, id: requestedId, maxVerify, timeoutMs },
      candidateCount: candidates.length,
      verifiedEmptyHomeCount: verified.filter(item => item.verifiedEmptyHome).length,
      verified,
      safety: 'read-only-dom-verification-no-write-no-click-no-close'
    });
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/browser-cdp-cleanup-plan-chatgpt-home', async (req, res) => {
  try {
    res.json(await buildChatGptHomeCleanupPlan(getPolicy(), {
      maxVerify: req.body?.maxVerify,
      maxClose: req.body?.maxClose,
      timeoutMs: req.body?.timeoutMs
    }));
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/browser-cdp-cleanup-chatgpt-home', async (req, res) => {
  try {
    res.json(await cleanupChatGptHomeTargets(getPolicy(), {
      confirmCleanup: req.body?.confirmCleanup === true,
      maxVerify: req.body?.maxVerify,
      maxClose: req.body?.maxClose,
      timeoutMs: req.body?.timeoutMs
    }));
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/browser-targets', async (_req, res) => {
  try {
    res.json(await listBrowserTargets());
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/browser-bind', async (req, res) => {
  try {
    res.json(await bindBrowserTarget({
      index: Number.isInteger(req.body?.index) ? req.body.index : undefined,
      url: typeof req.body?.url === 'string' ? req.body.url : undefined,
      urlContains: typeof req.body?.urlContains === 'string' ? req.body.urlContains : undefined
    }));
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
    const isJobBoardUrl = isJobBoardHost(rawTargetUrl.hostname.toLowerCase());
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
    const isJobBoardUrl = isJobBoardHost(rawTargetUrl.hostname.toLowerCase());
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

app.post('/page-capture', async (req, res) => {
  try {
    const target = await ensurePage();
    await target.bringToFront().catch(() => {});
    res.json(await capturePageArtifact(target, { screenshot: req.body?.screenshot === true }));
  } catch (error) {
    res.status(409).json({ ok: false, error: normalizeError(error) });
  }
});

app.post('/wait-for-ready', async (req, res) => {
  try {
    const target = await ensurePage();
    const allowedStates = new Set(['domcontentloaded', 'load', 'networkidle', 'selector-visible', 'selector-attached', 'mutation-quiet']);
    const state = allowedStates.has(req.body?.state) ? req.body.state : 'domcontentloaded';
    res.json(await waitForReadiness(target, {
      selector: typeof req.body?.selector === 'string' ? req.body.selector : '',
      state,
      timeoutMs: Number.isInteger(req.body?.timeoutMs) ? Math.min(Math.max(req.body.timeoutMs, 250), 60000) : 15000,
      quietMs: Number.isInteger(req.body?.quietMs) ? Math.min(Math.max(req.body.quietMs, 100), 10000) : 500
    }));
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
    const before = await capturePageArtifact(target, { screenshot: false });
    assertExpectedRevisions(expectedRevisionsFromBody(req.body), before);
    const fields = before.fields;

    const filled = [];
    for (const item of requestedFields) {
      const locator = await resolveRequestedFieldLocator(target, item, fields);
      await writeField(locator, item.value);
      filled.push(item.name || item.selector || item.index);
    }

    formFillCount += 1;
    fieldWriteCount += requestedFields.length;
    const after = await capturePageArtifact(target, { screenshot: false });

    res.json({
      ok: true,
      status: 'NETWORK_FORM_MUTATION_VERIFIED',
      filled,
      before: {
        targetId: before.targetId,
        pageRevision: before.pageRevision,
        formRevision: before.formRevision,
      },
      after: {
        targetId: after.targetId,
        pageRevision: after.pageRevision,
        formRevision: after.formRevision,
      },
    });
  } catch (error) {
    sendNetworkError(res, error, 'NETWORK_FORM_MUTATION_FAILED');
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
    const artifact = await capturePageArtifact(target, { screenshot: true, screenshotPrefix: 'review' });
    res.json({ ...artifact, message: 'Review manually before submit. Use reviewHash with submit-after-approval if the final action is approved.' });
  } catch (error) {
    res.status(409).json({ ok: false, error: error.message });
  }
});

app.post('/submit-after-approval', async (req, res) => {
  try {
    const policy = getPolicy();
    const approved = req.body?.approved === true;
    const approvalText = String(req.body?.approvalText || '');
    if (!policy.submitEnabled) {
      throw new Error('Final submit is disabled. Set NETWORK_MCP_ENABLE_SUBMIT=true to enable controlled submit actions.');
    }
    if (policy.requireApprovalForSubmit && (!approved || approvalText !== 'SUBMIT')) {
      throw new Error('Explicit approvalText=SUBMIT is required for final submit actions.');
    }

    const target = await ensurePage();
    await ensureNotChallenge(target);
    const before = await capturePageArtifact(target, { screenshot: false });
    assertExpectedRevisions(expectedRevisionsFromBody(req.body), before);
    const expectedReviewHash = String(req.body?.reviewHash || '').trim();
    if (expectedReviewHash && expectedReviewHash !== before.reviewHash) {
      throw new Error('Current page reviewHash does not match the approved reviewHash. Capture a fresh review artifact before submitting.');
    }

    const text = String(req.body?.text || '').trim();
    const selector = String(req.body?.selector || '').trim();
    const nth = Number.isInteger(req.body?.nth) && req.body.nth >= 0 ? req.body.nth : 0;
    let locator;
    if (selector) {
      locator = target.locator(selector);
    } else if (text) {
      locator = target.getByRole('button', { name: text, exact: true });
      if (await locator.count() === 0) {
        locator = target.getByRole('link', { name: text, exact: true });
      }
      if (await locator.count() === 0) {
        locator = target.getByText(text, { exact: true });
      }
    } else {
      locator = target.locator('button[type="submit"], input[type="submit"]').first();
    }

    const count = await locator.count();
    if (count <= nth) {
      throw new Error(`Submit target not found. Matches: ${count}. Requested index: ${nth}.`);
    }

    await locator.nth(nth).click();
    await target.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await ensureNotChallenge(target);
    const after = await capturePageArtifact(target, { screenshot: false });
    res.json({ ok: true, action: 'submit_after_approval', clicked: selector || text || 'default-submit', nth, beforeReviewHash: before.reviewHash, after });
  } catch (error) {
    sendNetworkError(res, error, 'NETWORK_SUBMIT_FAILED');
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
});

