import express from 'express';
import { chromium } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  isJobBoardHost,
  isSafeEditableInputType,
  normalizeBrowserChannel,
  parseList
} from './browser-policy.js';
import { settleClickTransition } from './click-transition-settle.js';
import { classifyFinalActionCandidate } from './final-action-classifier.js';

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
  hashStableJson,
  revisionError
} from './revision-contract.js';
import { resolveGuardedUploadArtifact } from './upload-artifact.js';
import { classifyHumanBoundary } from './human-boundary.js';
import { enumerateFrameTree, resolveFrameByPath } from './frame-path.js';
import { classifySubmitPostcondition } from './submit-postcondition.js';
import {
  approvalPayloadHash,
  consumeApprovalReceipt,
  createApprovalReceipt,
  normalizeFillApprovalOperations
} from './approval-receipt.js';
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
    requireApprovalForUpload: String(process.env.NETWORK_MCP_REQUIRE_APPROVAL_FOR_UPLOAD || 'true').toLowerCase() !== 'false',
    requireApprovalReceiptForFill: String(process.env.NETWORK_MCP_REQUIRE_APPROVAL_RECEIPT_FOR_FILL || 'true').toLowerCase() !== 'false',
    requireApprovalReceiptForSubmit: String(process.env.NETWORK_MCP_REQUIRE_APPROVAL_RECEIPT_FOR_SUBMIT || 'true').toLowerCase() !== 'false',
    approvalReceiptRoot: path.resolve(String(process.env.NETWORK_MCP_APPROVAL_RECEIPT_ROOT || path.join(process.cwd(), 'var', 'browser', 'approval-receipts')).trim()),
    approvalReceiptTtlMs: Number(process.env.NETWORK_MCP_APPROVAL_RECEIPT_TTL_MS || 900000),
    uploadRoot: path.resolve(String(process.env.NETWORK_MCP_UPLOAD_ROOT || path.join(process.cwd(), 'var', 'artifacts', 'uploads')).trim()),
    maxUploadBytes: Number(process.env.NETWORK_MCP_MAX_UPLOAD_BYTES || 26214400),
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
    externalAttachTimeoutMs: Number(process.env.NETWORK_MCP_EXTERNAL_ATTACH_TIMEOUT_MS || 15000)
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
  const snapshot = await target.evaluate(() => {
    const title = document.title || '';
    const body = document.body?.innerText || '';
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const isVisible = element => {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && rect.width > 0
        && rect.height > 0;
    };
    const visibleTexts = selector => Array.from(document.querySelectorAll(selector))
      .filter(isVisible)
      .map(element => normalize(element.innerText || element.textContent || ''))
      .filter(Boolean);

    const consentText = visibleTexts([
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[id*="cookie" i]',
      '[class*="cookie" i]',
      '[id*="consent" i]',
      '[class*="consent" i]',
    ].join(', ')).join(' ').slice(0, 4000);

    const alertDialogText = visibleTexts('[role="alertdialog"], dialog[open][role="alertdialog"]')
      .join(' ')
      .slice(0, 2000);

    return {
      title,
      text: `${title}\n${body}`.slice(0, 4000),
      hasPasswordField: Boolean(document.querySelector('input[type="password"]')),
      hasCredentialIdentifierField: Boolean(document.querySelector([
        'input[autocomplete="username"]',
        'input[name*="username" i]',
        'input[name*="userName" i]',
        'input[name*="email" i]',
        'input[name*="phone" i]',
        'input[aria-label*="email" i]',
        'input[aria-label*="phone" i]'
      ].join(', '))),
      consentText,
      alertDialogText,
    };
  });

  const boundary = classifyHumanBoundary({
    text: snapshot.text,
    url: target.url(),
    hasPasswordField: snapshot.hasPasswordField,
    hasCredentialIdentifierField: snapshot.hasCredentialIdentifierField,
    consentText: snapshot.consentText,
    alertDialogText: snapshot.alertDialogText,
  });
  if (boundary) {
    throw revisionError(
      'NETWORK_HUMAN_ACTION_REQUIRED',
      'A human-action boundary was detected. Resolve it manually before Network resumes.',
      {
        boundary: {
          type: boundary.type,
          requestedAction: boundary.requestedAction,
          targetUrl: target.url(),
          title: String(snapshot.title || '').slice(0, 300),
          resumeCondition: 'Re-run page capture or the intended Network operation after the human step is complete.'
        }
      }
    );
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

async function connectToExistingCdpEndpoint(endpoint, timeoutMs = 15000) {
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
  const timeoutMs = Number.isFinite(policy.externalAttachTimeoutMs) ? policy.externalAttachTimeoutMs : 15000;
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

const SEMANTIC_FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"], [role="switch"], [aria-autocomplete], input[list], [role="slider"], [role="spinbutton"]';

async function snapshotFieldsInFrame(frame, framePath, frameUrl, frameName) {
  const rawFields = await frame.locator(SEMANTIC_FIELD_SELECTOR).evaluateAll(nodes => nodes.map((node, index) => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    const tag = node.tagName.toLowerCase();
    const type = String(node.getAttribute('type') || '').toLowerCase();
    const role = String(node.getAttribute('role') || '').toLowerCase();
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0;
    const enabled = !node.disabled && node.getAttribute('aria-disabled') !== 'true';
    const readOnly = Boolean(node.readOnly) || node.getAttribute('aria-readonly') === 'true';
    const id = node.getAttribute('id') || '';
    const nodeRoot = node.getRootNode();
    const queryRoot = nodeRoot && typeof nodeRoot.querySelector === 'function' ? nodeRoot : document;
    const explicit = id ? queryRoot.querySelector('label[for="' + id.replace(/"/g, '\\"') + '"]') : null;
    const wrapping = node.closest('label');
    const labelledBy = String(node.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .filter(Boolean)
      .map(item => queryRoot.querySelector('[id="' + item.replace(/"/g, '\\"') + '"]'))
      .filter(Boolean)
      .map(element => normalize(element.innerText || element.textContent || ''))
      .join(' ');
    const labelText = normalize(labelledBy || explicit?.innerText || explicit?.textContent || wrapping?.innerText || wrapping?.textContent || '');
    const container = node.closest('fieldset, li, tr, .question, .form-group, .form-row, .field, .field-wrapper, .formField, .questionWrapper, .questionContainer, section, article, div');
    const contextText = container ? normalize(container.innerText || container.textContent || '') : '';
    const shadowPath = [];
    let shadowRoot = nodeRoot;
    while (shadowRoot && shadowRoot.host) {
      const host = shadowRoot.host;
      const parent = host.parentNode;
      const siblings = parent && parent.children ? Array.from(parent.children) : [];
      shadowPath.unshift({
        tag: host.tagName.toLowerCase(),
        id: host.getAttribute('id') || '',
        name: host.getAttribute('name') || '',
        role: host.getAttribute('role') || '',
        index: siblings.indexOf(host),
      });
      shadowRoot = host.getRootNode();
    }

    let semanticType = 'unsupported';
    if (tag === 'select') semanticType = 'select';
    else if (tag === 'textarea') semanticType = 'textarea';
    else if (role === 'switch') semanticType = 'switch';
    else if (node.hasAttribute('aria-autocomplete') || (tag === 'input' && node.hasAttribute('list'))) semanticType = 'autocomplete';
    else if (role === 'combobox') semanticType = 'combobox';
    else if (node.getAttribute('contenteditable') === 'true') semanticType = 'contenteditable';
    else if (tag === 'input') {
      if (type === 'checkbox') semanticType = 'checkbox';
      else if (type === 'radio') semanticType = 'radio';
      else if (type === 'file') semanticType = 'file';
      else if (type === 'email') semanticType = 'email';
      else if (type === 'tel') semanticType = 'phone';
      else if (type === 'number' || type === 'range') semanticType = 'number';
      else if (['date', 'datetime-local', 'month', 'time', 'week'].includes(type)) semanticType = 'date-time';
      else if (type === 'password') semanticType = 'password';
      else semanticType = 'text';
    }

    const nativeTextEditable = tag === 'textarea'
      || tag === 'select'
      || (tag === 'input' && !['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset', 'checkbox', 'radio'].includes(type));

    let blockedReason = '';
    if (!visible) blockedReason = 'Field is not visible';
    else if (!enabled) blockedReason = 'Field is disabled';
    else if (readOnly) blockedReason = 'Field is read-only';
    else if (semanticType === 'password') blockedReason = 'Sensitive password field is not writable';
    else if (semanticType === 'file') blockedReason = 'File control requires the guarded upload capability';
    else if (!nativeTextEditable && !['checkbox', 'radio', 'contenteditable', 'combobox', 'autocomplete', 'switch'].includes(semanticType)) blockedReason = `Unsupported semantic control type: ${semanticType}`;

    const supportedOperations = semanticType === 'file'
      ? ['upload']
      : semanticType === 'checkbox'
        ? ['check', 'uncheck']
        : semanticType === 'switch'
          ? ['switch-on', 'switch-off']
        : semanticType === 'radio'
          ? ['choose', 'choose-option']
          : semanticType === 'select'
            ? (node.multiple ? ['select-multiple'] : ['select'])
            : ['text', 'textarea', 'email', 'phone', 'number', 'date-time'].includes(semanticType)
              ? ['set', 'clear']
              : ['combobox', 'autocomplete'].includes(semanticType)
                ? ['choose-option']
                : semanticType === 'contenteditable'
                  ? ['set-rich-text']
                  : [];

    const options = tag === 'select'
      ? Array.from(node.options || []).slice(0, 500).map(option => ({
          value: String(option.value ?? ''),
          label: normalize(option.label || option.textContent || ''),
          selected: Boolean(option.selected),
          disabled: Boolean(option.disabled),
        }))
      : semanticType === 'autocomplete' && tag === 'input' && node.list
        ? Array.from(node.list.options || []).slice(0, 500).map(option => ({
            value: String(option.value ?? ''),
            label: normalize(option.label || option.textContent || option.value || ''),
            selected: String(node.value ?? '') === String(option.value ?? ''),
            disabled: Boolean(option.disabled),
          }))
      : semanticType === 'radio' && node.getAttribute('name')
        ? Array.from(queryRoot.querySelectorAll('input[type="radio"][name="' + String(node.getAttribute('name')).replace(/"/g, '\\"') + '"]')).slice(0, 200).map(option => ({
            value: String(option.value || ''),
            label: (() => {
              const optionId = option.getAttribute('id') || '';
              const optionRoot = option.getRootNode();
              const optionQueryRoot = optionRoot && typeof optionRoot.querySelector === 'function' ? optionRoot : document;
              const optionLabel = optionId ? optionQueryRoot.querySelector('label[for="' + optionId.replace(/"/g, '\\"') + '"]') : option.closest('label');
              return normalize(optionLabel?.innerText || optionLabel?.textContent || option.getAttribute('aria-label') || option.value || '');
            })(),
            selected: Boolean(option.checked),
            disabled: Boolean(option.disabled),
          }))
        : [];

    const semanticValue = semanticType === 'switch'
      ? node.getAttribute('aria-checked') === 'true'
      : semanticType === 'checkbox' || semanticType === 'radio'
        ? Boolean(node.checked)
      : tag === 'select' && node.multiple
        ? Array.from(node.selectedOptions || []).map(option => String(option.value ?? ''))
        : node.getAttribute('contenteditable') === 'true'
          ? normalize(node.innerText || node.textContent || '')
          : String(node.value ?? '');

    const validity = typeof node.checkValidity === 'function'
      ? {
          valid: node.checkValidity(),
          validationMessage: normalize(node.validationMessage || ''),
          ariaInvalid: node.getAttribute('aria-invalid') || '',
        }
      : {
          valid: node.getAttribute('aria-invalid') !== 'true',
          validationMessage: '',
          ariaInvalid: node.getAttribute('aria-invalid') || '',
        };

    return {
      index,
      tag,
      type,
      role,
      semanticType,
      name: node.getAttribute('name') || '',
      id,
      placeholder: node.getAttribute('placeholder') || '',
      ariaLabel: node.getAttribute('aria-label') || '',
      labelText,
      contextText,
      shadowPath,
      shadowDepth: shadowPath.length,
      required: node.hasAttribute('required') || node.getAttribute('aria-required') === 'true',
      visible,
      enabled,
      readOnly,
      safeEditable: (nativeTextEditable || ['checkbox', 'radio', 'contenteditable', 'combobox', 'autocomplete', 'switch'].includes(semanticType)) && visible && enabled && !readOnly && !blockedReason,
      blockedReason,
      sensitive: semanticType === 'password',
      checked: semanticType === 'switch' ? node.getAttribute('aria-checked') === 'true' : semanticType === 'checkbox' || semanticType === 'radio' ? Boolean(node.checked) : null,
      multiple: Boolean(node.multiple),
      autocompleteMode: semanticType === 'autocomplete' ? (tag === 'input' && node.list ? 'native-datalist' : 'aria') : null,
      radioGroup: semanticType === 'radio' ? {
        name: node.getAttribute('name') || '',
        size: options.length,
        selectedValue: options.find(option => option.selected)?.value ?? null,
        selectedLabel: options.find(option => option.selected)?.label ?? null,
      } : null,
      options,
      supportedOperations,
      validation: validity,
      value: semanticValue,
    };
  }));

  const occurrenceByFingerprint = new Map();
  return rawFields.map(field => {
    const fingerprint = hashStableJson({
      framePath,
      shadowPath: field.shadowPath,
      tag: field.tag,
      semanticType: field.semanticType,
      name: field.name,
      id: field.id,
      labelText: field.labelText,
      ariaLabel: field.ariaLabel,
      placeholder: field.placeholder,
      contextText: String(field.contextText || '').slice(0, 300),
      options: Array.isArray(field.options) ? field.options.map(option => [option.value, option.label]) : [],
    });
    const occurrence = occurrenceByFingerprint.get(fingerprint) ?? 0;
    occurrenceByFingerprint.set(fingerprint, occurrence + 1);

    return {
      ...field,
      localIndex: field.index,
      framePath: [...framePath],
      frameUrl,
      frameName,
      controlId: `control:${hashStableJson({ fingerprint, occurrence })}`,
      semanticModelVersion: 4,
    };
  });
}


async function snapshotFields(target) {
  const fields = [];
  for (const frameInfo of enumerateFrameTree(target)) {
    const frameFields = await snapshotFieldsInFrame(
      frameInfo.frame,
      frameInfo.framePath,
      frameInfo.frameUrl,
      frameInfo.frameName,
    );
    for (const field of frameFields) {
      fields.push({
        ...field,
        index: fields.length,
      });
    }
  }
  return fields;
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
    const isFinal = classifyFinalActionCandidate({ text, type });
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

function normalizeExecutionCorrelation(body) {
  const input = body?.correlation;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const normalize = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
  const taskId = normalize(input.taskId);
  const runId = normalize(input.runId);
  const invocationId = normalize(input.invocationId);
  if (!taskId && !runId && !invocationId) return null;
  return {
    executionOwner: 'console-mcp',
    taskId,
    runId,
    invocationId,
  };
}

function sendNetworkError(res, error, fallbackStatus = 'NETWORK_OPERATION_FAILED', correlation = null) {
  res.status(409).json({
    ok: false,
    status: typeof error?.networkStatus === 'string' ? error.networkStatus : fallbackStatus,
    error: normalizeError(error),
    correlation,
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
    const closed = item.isClosed();
    targets.push({
      index,
      targetId: closed ? null : await getPageTargetId(item),
      active: item === page,
      closed,
      url: closed ? null : item.url(),
      title: closed ? null : await item.title().catch(() => null)
    });
  }

  const active = targets.find(item => item.active) ?? null;
  return {
    ok: true,
    activeIndex: active?.index ?? null,
    activeTargetId: active?.targetId ?? null,
    targets
  };
}

async function bindBrowserTarget({ targetId, index, url, urlContains } = {}) {
  await ensurePage();
  const pages = browser ? browser.pages() : [];
  let selected = null;

  if (targetId) {
    for (const candidate of pages) {
      if (candidate.isClosed()) continue;
      if (await getPageTargetId(candidate) === String(targetId)) {
        selected = candidate;
        break;
      }
    }
  } else if (Number.isInteger(index)) {
    selected = pages[index] ?? null;
  } else if (url) {
    selected = pages.find(item => !item.isClosed() && item.url() === String(url)) ?? null;
  } else if (urlContains) {
    selected = pages.find(item => !item.isClosed() && item.url().includes(String(urlContains))) ?? null;
  }

  if (!selected || selected.isClosed()) {
    throw revisionError('NETWORK_TARGET_STALE', 'Requested browser target was not found or is closed.', {
      targetId: targetId ? String(targetId) : null,
      index: Number.isInteger(index) ? index : null,
      url: url ? String(url) : null,
      urlContains: urlContains ? String(urlContains) : null
    });
  }

  page = selected;
  await page.bringToFront().catch(() => {});
  return {
    ok: true,
    status: 'NETWORK_TARGET_BOUND',
    bound: {
      targetId: await getPageTargetId(page),
      index: pages.findIndex(item => item === page),
      url: page.url(),
      title: await page.title().catch(() => '')
    }
  };
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

async function writeField(target, locator, value, field = {}) {
  const tagName = await locator.evaluate(node => node.tagName.toLowerCase());
  const semanticType = field.semanticType || await locator.evaluate(node => {
    const tag = node.tagName.toLowerCase();
    const type = String(node.getAttribute('type') || '').toLowerCase();
    const role = String(node.getAttribute('role') || '').toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (role === 'switch') return 'switch';
    if (node.hasAttribute('aria-autocomplete') || (tag === 'input' && node.hasAttribute('list'))) return 'autocomplete';
    if (role === 'combobox') return 'combobox';
    if (node.getAttribute('contenteditable') === 'true') return 'contenteditable';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'text';
  });

  if (semanticType === 'select' || tagName === 'select') {
    const multiple = field.multiple === true || await locator.evaluate(node => Boolean(node.multiple));
    if (multiple) {
      if (!Array.isArray(value)) {
        throw revisionError('NETWORK_VALIDATION_FAILED', 'Multi-select mutation requires an array of option values.', { controlId: field.controlId || null });
      }
      const desired = [...new Set(value.map(item => String(item)))];
      await locator.selectOption(desired);
      const actual = await locator.evaluate(node => Array.from(node.selectedOptions || []).map(option => String(option.value ?? '')));
      const normalizedDesired = [...desired].sort();
      const normalizedActual = [...actual].sort();
      if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedDesired)) {
        throw revisionError('NETWORK_VALIDATION_FAILED', 'Multi-select postcondition did not match the requested option set.', { desired, actual, controlId: field.controlId || null });
      }
      return { semanticType: 'select', multiple: true, requested: desired, actual };
    }

    const desired = String(value ?? '');
    await locator.selectOption(desired);
    const actual = await locator.inputValue();
    if (actual !== desired) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Select postcondition did not match the requested value.', { desired, actual, controlId: field.controlId || null });
    }
    return { semanticType: 'select', multiple: false, requested: desired, actual };
  }

  if (semanticType === 'checkbox') {
    const desired = normalizeBooleanMutationValue(value);
    if (desired) await locator.check();
    else await locator.uncheck();
    const actual = await locator.isChecked();
    if (actual !== desired) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Checkbox postcondition did not match the requested checked state.', { desired, actual, controlId: field.controlId || null });
    }
    return { semanticType: 'checkbox', requested: desired, actual };
  }

  if (semanticType === 'switch') {
    const desired = normalizeBooleanMutationValue(value);
    const before = await locator.getAttribute('aria-checked') === 'true';
    if (before !== desired) {
      await locator.click();
    }
    const actual = await locator.getAttribute('aria-checked') === 'true';
    if (actual !== desired) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Switch postcondition did not match the requested state.', { desired, actual, controlId: field.controlId || null });
    }
    return { semanticType: 'switch', requested: desired, actual };
  }

  if (semanticType === 'radio') {
    if (typeof value === 'string' && value.trim()) {
      const desired = value.trim();
      const options = Array.isArray(field.options) ? field.options : [];
      const matches = options.filter(option => !option.disabled && (String(option.value ?? '') === desired || String(option.label ?? '') === desired));
      if (matches.length !== 1) {
        throw revisionError(
          matches.length === 0 ? 'NETWORK_FIELD_NOT_FOUND' : 'NETWORK_FIELD_AMBIGUOUS',
          matches.length === 0
            ? 'Radio-group option was not found by exact value or label.'
            : 'Radio-group option is ambiguous by exact value or label.',
          { desired, optionCount: matches.length, controlId: field.controlId || null, groupName: field.name || null }
        );
      }
      const selected = matches[0];
      const accessibleName = String(selected.label || '').trim();
      if (!accessibleName) {
        throw revisionError('NETWORK_CONTROL_UNSUPPORTED', 'Radio-group exact selection requires an accessible option label.', { desired, value: selected.value ?? null, controlId: field.controlId || null });
      }
      const optionFrame = resolveFrameByPath(target, Array.isArray(field.framePath) ? field.framePath : []) ?? target.mainFrame();
      const option = optionFrame.getByRole('radio', { name: accessibleName, exact: true });
      const optionCount = await option.count();
      if (optionCount !== 1) {
        throw revisionError(
          optionCount === 0 ? 'NETWORK_FIELD_NOT_FOUND' : 'NETWORK_FIELD_AMBIGUOUS',
          optionCount === 0
            ? 'Radio-group option was not found by exact accessible name.'
            : 'Radio-group option accessible name is ambiguous.',
          { desired, accessibleName, optionCount, controlId: field.controlId || null }
        );
      }
      await option.check();
      const actual = await option.isChecked();
      if (!actual) {
        throw revisionError('NETWORK_VALIDATION_FAILED', 'Radio-group postcondition did not confirm the requested option.', { desired, accessibleName, actual, controlId: field.controlId || null });
      }
      return {
        semanticType: 'radio',
        groupSelection: true,
        requested: desired,
        actual: String(selected.value ?? ''),
        actualLabel: accessibleName,
        optionMatch: 'exact-value-or-label-and-accessible-name',
      };
    }

    const desired = normalizeBooleanMutationValue(value, true);
    if (!desired) {
      throw revisionError('NETWORK_CONTROL_UNSUPPORTED', 'A radio control can only be selected; deselect by choosing another option in the group.', { controlId: field.controlId || null });
    }
    await locator.check();
    const actual = await locator.isChecked();
    if (!actual) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Radio postcondition did not confirm the requested option.', { desired: true, actual, controlId: field.controlId || null });
    }
    return { semanticType: 'radio', groupSelection: false, requested: true, actual };
  }

  if (semanticType === 'contenteditable') {
    const desired = String(value ?? '');
    await locator.fill(desired);
    const actual = await locator.evaluate(node => String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim());
    const normalizedDesired = desired.replace(/\s+/g, ' ').trim();
    if (actual !== normalizedDesired) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Contenteditable postcondition did not match the requested text.', { desired: normalizedDesired, actual, controlId: field.controlId || null });
    }
    return { semanticType: 'contenteditable', requested: normalizedDesired, actual };
  }

  if (semanticType === 'autocomplete') {
    const desired = String(value ?? '').trim();
    if (!desired) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Autocomplete mutation requires a non-empty option label or value.', { controlId: field.controlId || null });
    }

    const autocompleteMode = field.autocompleteMode || await locator.evaluate(node => node.tagName.toLowerCase() === 'input' && node.list ? 'native-datalist' : 'aria');
    if (autocompleteMode === 'native-datalist') {
      const options = await locator.evaluate(node => Array.from(node.list?.options || []).slice(0, 500).map(option => ({
        value: String(option.value ?? ''),
        label: String(option.label || option.textContent || option.value || '').replace(/\s+/g, ' ').trim(),
        disabled: Boolean(option.disabled),
      })));
      const matches = options.filter(option => !option.disabled && (option.value === desired || option.label === desired));
      if (matches.length !== 1) {
        throw revisionError(
          matches.length === 0 ? 'NETWORK_FIELD_NOT_FOUND' : 'NETWORK_FIELD_AMBIGUOUS',
          matches.length === 0
            ? 'Native datalist option was not found by exact value or label.'
            : 'Native datalist option is ambiguous by exact value or label.',
          { desired, optionCount: matches.length, controlId: field.controlId || null }
        );
      }
      const canonicalValue = matches[0].value;
      await locator.fill(canonicalValue);
      const actual = await locator.inputValue();
      if (actual !== canonicalValue) {
        throw revisionError('NETWORK_VALIDATION_FAILED', 'Native datalist postcondition did not match the selected value.', { desired, canonicalValue, actual, controlId: field.controlId || null });
      }
      return { semanticType: 'autocomplete', mode: 'native-datalist', requested: desired, actual, optionMatch: 'exact-value-or-label' };
    }

    const fillable = await locator.evaluate(node => {
      const tag = node.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || node.getAttribute('contenteditable') === 'true';
    });
    if (!fillable) {
      throw revisionError('NETWORK_CONTROL_UNSUPPORTED', 'ARIA autocomplete mutation only supports input/textarea/contenteditable controls.', { controlId: field.controlId || null, tagName });
    }

    await locator.click();
    await locator.fill(desired);
    const optionFrame = resolveFrameByPath(target, Array.isArray(field.framePath) ? field.framePath : []) ?? target.mainFrame();
    const option = optionFrame.getByRole('option', { name: desired, exact: true });
    const optionCount = await option.count();
    if (optionCount !== 1) {
      throw revisionError(
        optionCount === 0 ? 'NETWORK_FIELD_NOT_FOUND' : 'NETWORK_FIELD_AMBIGUOUS',
        optionCount === 0
          ? 'Autocomplete option was not found by exact accessible name.'
          : 'Autocomplete option accessible name is ambiguous.',
        { desired, optionCount, controlId: field.controlId || null }
      );
    }
    await option.click();
    const actual = await locator.evaluate(node => {
      if ('value' in node) return String(node.value ?? '').trim();
      return String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    });
    if (actual !== desired) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Autocomplete postcondition did not match the selected option.', { desired, actual, controlId: field.controlId || null });
    }
    return { semanticType: 'autocomplete', mode: 'aria', requested: desired, actual, optionMatch: 'exact-accessible-name' };
  }

  if (semanticType === 'combobox') {
    const desired = String(value ?? '').trim();
    if (!desired) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Combobox mutation requires a non-empty option label.', { controlId: field.controlId || null });
    }

    const fillable = await locator.evaluate(node => {
      const tag = node.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || node.getAttribute('contenteditable') === 'true';
    });
    if (!fillable) {
      throw revisionError('NETWORK_CONTROL_UNSUPPORTED', 'Generic combobox mutation only supports input/textarea/contenteditable combobox controls.', { controlId: field.controlId || null, tagName });
    }

    await locator.click();
    await locator.fill(desired);
    const optionFrame = resolveFrameByPath(target, Array.isArray(field.framePath) ? field.framePath : []) ?? target.mainFrame();
    const option = optionFrame.getByRole('option', { name: desired, exact: true });
    const optionCount = await option.count();
    if (optionCount !== 1) {
      throw revisionError(
        optionCount === 0 ? 'NETWORK_FIELD_NOT_FOUND' : 'NETWORK_FIELD_AMBIGUOUS',
        optionCount === 0
          ? 'Combobox option was not found by exact accessible name.'
          : 'Combobox option accessible name is ambiguous.',
        { desired, optionCount, controlId: field.controlId || null }
      );
    }

    await option.click();
    const actual = await locator.evaluate(node => {
      if ('value' in node) return String(node.value ?? '').trim();
      return String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
    });
    if (actual !== desired) {
      throw revisionError('NETWORK_VALIDATION_FAILED', 'Combobox postcondition did not match the selected option.', { desired, actual, controlId: field.controlId || null });
    }
    return { semanticType: 'combobox', requested: desired, actual, optionMatch: 'exact-accessible-name' };
  }

  const desired = String(value ?? '');
  await locator.fill(desired);
  const actual = await locator.inputValue();
  if (actual !== desired) {
    throw revisionError('NETWORK_VALIDATION_FAILED', 'Text-field postcondition did not match the requested value.', { desired, actual, controlId: field.controlId || null });
  }
  return { semanticType, requested: desired, actual };
}

function normalizeBooleanMutationValue(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['true', '1', 'yes', 'on', 'checked', 'select', 'selected'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', 'unchecked'].includes(normalized)) return false;
  throw revisionError('NETWORK_VALIDATION_FAILED', 'Boolean control value must be an explicit boolean-like value.', { received: String(value) });
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

function assertSafeMutableField(field, identityEvidence = {}) {
  if (isSafeFieldSnapshot(field)) {
    return;
  }

  if (field?.semanticType === 'unsupported') {
    const boundary = classifyHumanBoundary({
      unsupportedControl: {
        controlId: field?.controlId || null,
        semanticType: field?.semanticType || null,
        blockedReason: field?.blockedReason || null,
      }
    });
    throw revisionError(
      'NETWORK_HUMAN_ACTION_REQUIRED',
      'An unsupported form control requires manual completion before Network can continue.',
      {
        boundary: {
          type: boundary?.type || 'unsupported_control',
          requestedAction: boundary?.requestedAction || 'Complete the unsupported control manually, then re-inspect the form.',
          controlId: field?.controlId || null,
          semanticType: field?.semanticType || null,
          blockedReason: field?.blockedReason || null,
          resumeCondition: 'Re-inspect the form after the unsupported control has been resolved manually.'
        },
        ...identityEvidence,
      }
    );
  }

  throw revisionError(
    'NETWORK_CONTROL_UNSUPPORTED',
    field?.blockedReason || 'Control is not safely editable.',
    {
      semanticType: field?.semanticType || null,
      ...identityEvidence,
    }
  );
}

function getRequestedFieldIndex(item) {
  if (Number.isInteger(item?.index) && item.index >= 0) {
    return item.index;
  }

  return null;
}

function getRequestedControlId(item) {
  return typeof item?.controlId === 'string' && item.controlId.trim() ? item.controlId.trim() : null;
}

async function locatorForFieldSnapshot(target, field) {
  const framePath = Array.isArray(field?.framePath) ? field.framePath : [];
  const frame = resolveFrameByPath(target, framePath);
  if (!frame) {
    throw revisionError(
      'NETWORK_FRAME_STALE',
      'The frame path for this control no longer exists. Re-inspect the form before mutating.',
      { framePath, controlId: field?.controlId || null }
    );
  }

  const localIndex = Number.isInteger(field?.localIndex) ? field.localIndex : field?.index;
  if (!Number.isInteger(localIndex) || localIndex < 0) {
    throw revisionError('NETWORK_FIELD_NOT_FOUND', 'The control does not have a valid frame-local index.', {
      framePath,
      controlId: field?.controlId || null
    });
  }

  const locator = frame.locator(SEMANTIC_FIELD_SELECTOR).nth(localIndex);
  const actualShadowPath = await locator.evaluate(node => {
    const path = [];
    let root = node.getRootNode();
    while (root && root.host) {
      const host = root.host;
      const parent = host.parentNode;
      const siblings = parent && parent.children ? Array.from(parent.children) : [];
      path.unshift({
        tag: host.tagName.toLowerCase(),
        id: host.getAttribute('id') || '',
        name: host.getAttribute('name') || '',
        role: host.getAttribute('role') || '',
        index: siblings.indexOf(host),
      });
      root = host.getRootNode();
    }
    return path;
  });
  const expectedShadowPath = Array.isArray(field?.shadowPath) ? field.shadowPath : [];
  if (hashStableJson(actualShadowPath) !== hashStableJson(expectedShadowPath)) {
    throw revisionError(
      'NETWORK_SHADOW_PATH_STALE',
      'The open-shadow host path for this control changed. Re-inspect the form before mutating.',
      { expectedShadowPath, actualShadowPath, controlId: field?.controlId || null }
    );
  }

  return locator;
}

async function resolveRequestedFieldLocator(target, item, fields) {
  const controlId = getRequestedControlId(item);
  if (controlId) {
    const field = fields.find(candidate => candidate.controlId === controlId);
    if (!field) {
      throw revisionError('NETWORK_FIELD_NOT_FOUND', 'Control identity is stale or missing from the current form revision.', { controlId });
    }
    assertSafeMutableField(field, { controlId });

    return { locator: await locatorForFieldSnapshot(target, field), field };
  }

  const index = getRequestedFieldIndex(item);
  if (index !== null) {
    const field = fields[index];
    if (!field) {
      throw revisionError('NETWORK_FIELD_NOT_FOUND', 'Legacy field index is out of range for the current form revision.', { index });
    }

    assertSafeMutableField(field, { index });

    return { locator: await locatorForFieldSnapshot(target, field), field };
  }

  if (typeof item?.selector === 'string' && item.selector.trim()) {
    return describeSelectorField(target, item.selector.trim());
  }

  throw revisionError('NETWORK_FIELD_NOT_FOUND', 'Each mutation must identify a control by controlId, legacy index, or exact selector.');
}

async function resolveUploadControl(target, item, fields) {
  const controlId = getRequestedControlId(item);
  if (controlId) {
    const field = fields.find(candidate => candidate.controlId === controlId);
    if (!field) {
      throw revisionError('NETWORK_FIELD_NOT_FOUND', 'Upload control identity is stale or missing from the current form revision.', { controlId });
    }
    if (field.semanticType !== 'file') {
      throw revisionError('NETWORK_CONTROL_UNSUPPORTED', 'The requested upload control is not a file input.', { controlId, semanticType: field.semanticType });
    }
    return { locator: await locatorForFieldSnapshot(target, field), field };
  }

  const selector = typeof item?.selector === 'string' ? item.selector.trim() : '';
  if (!selector) {
    throw revisionError('NETWORK_UPLOAD_CONTROL_REQUIRED', 'Upload requires an exact file controlId or selector.');
  }

  const locator = target.locator(selector);
  const count = await locator.count();
  if (count !== 1) {
    throw revisionError(
      count === 0 ? 'NETWORK_FIELD_NOT_FOUND' : 'NETWORK_FIELD_AMBIGUOUS',
      'Upload selector must resolve to exactly one file control.',
      { selector, count }
    );
  }

  const field = await locator.evaluate(node => ({
    tag: node.tagName.toLowerCase(),
    type: String(node.getAttribute('type') || '').toLowerCase(),
    visible: (() => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })(),
    enabled: !node.disabled && node.getAttribute('aria-disabled') !== 'true'
  }));
  if (field.tag !== 'input' || field.type !== 'file') {
    throw revisionError('NETWORK_CONTROL_UNSUPPORTED', 'Upload selector must resolve to input[type=file].', { selector, tag: field.tag, type: field.type });
  }
  if (!field.enabled) {
    throw revisionError('NETWORK_CONTROL_UNSUPPORTED', 'Upload file control is disabled.', { selector });
  }

  return {
    locator,
    field: {
      ...field,
      semanticType: 'file',
      controlId: `selector:${hashStableJson({ selector, type: 'file' })}`,
      semanticModelVersion: 2
    }
  };
}

async function describeSelectorField(target, selector) {
  const locator = target.locator(selector);
  const count = await locator.count();
  if (count !== 1) {
    throw new Error(`Selector must resolve to exactly one field. Found ${count}.`);
  }

  const field = await locator.evaluate(node => {
    const tag = node.tagName.toLowerCase();
    const type = String(node.getAttribute('type') || '').toLowerCase();
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0;
    const enabled = !node.disabled && node.getAttribute('aria-disabled') !== 'true';
    const readOnly = Boolean(node.readOnly) || node.getAttribute('aria-readonly') === 'true';
    const role = String(node.getAttribute('role') || '').toLowerCase();
    let semanticType = 'unsupported';
    if (tag === 'select') semanticType = 'select';
    else if (tag === 'textarea') semanticType = 'textarea';
    else if (role === 'switch') semanticType = 'switch';
    else if (node.hasAttribute('aria-autocomplete') || (tag === 'input' && node.hasAttribute('list'))) semanticType = 'autocomplete';
    else if (role === 'combobox') semanticType = 'combobox';
    else if (node.getAttribute('contenteditable') === 'true') semanticType = 'contenteditable';
    else if (tag === 'input') {
      if (type === 'checkbox') semanticType = 'checkbox';
      else if (type === 'radio') semanticType = 'radio';
      else if (type === 'file') semanticType = 'file';
      else if (type === 'email') semanticType = 'email';
      else if (type === 'tel') semanticType = 'phone';
      else if (type === 'number' || type === 'range') semanticType = 'number';
      else if (['date', 'datetime-local', 'month', 'time', 'week'].includes(type)) semanticType = 'date-time';
      else if (type === 'password') semanticType = 'password';
      else if (!['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) semanticType = 'text';
    }
    const safeEditable = ['select', 'textarea', 'text', 'email', 'phone', 'number', 'date-time', 'checkbox', 'radio', 'contenteditable', 'combobox', 'autocomplete', 'switch'].includes(semanticType)
      && visible
      && enabled
      && !readOnly;

    let blockedReason = '';
    if (!visible) blockedReason = 'Field is not visible';
    else if (!enabled) blockedReason = 'Field is disabled';
    else if (readOnly) blockedReason = 'Field is read-only';
    else if (semanticType === 'file') blockedReason = 'File control requires the guarded upload capability';
    else if (semanticType === 'password') blockedReason = 'Sensitive password field is not writable';
    else if (!safeEditable) blockedReason = `Unsupported semantic control type: ${semanticType}`;

    return {
      tag,
      type,
      semanticType,
      name: node.getAttribute('name') || '',
      id: node.getAttribute('id') || '',
      placeholder: node.getAttribute('placeholder') || '',
      ariaLabel: node.getAttribute('aria-label') || '',
      required: node.hasAttribute('required') || node.getAttribute('aria-required') === 'true',
      visible,
      enabled,
      readOnly,
      safeEditable,
      blockedReason,
      checked: semanticType === 'switch' ? node.getAttribute('aria-checked') === 'true' : semanticType === 'checkbox' || semanticType === 'radio' ? Boolean(node.checked) : null,
      value: semanticType === 'switch' ? node.getAttribute('aria-checked') === 'true' : semanticType === 'checkbox' || semanticType === 'radio' ? Boolean(node.checked) : String(node.value ?? ''),
    };
  });

  const resolvedField = {
    ...field,
    controlId: `selector:${hashStableJson({ selector, semanticType: field.semanticType, name: field.name, id: field.id })}`,
    semanticModelVersion: 4,
  };
  assertSafeMutableField(resolvedField, { selector });

  return {
    locator,
    field: resolvedField,
  };
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
      targetId: typeof req.body?.targetId === 'string' ? req.body.targetId.trim() : undefined,
      index: Number.isInteger(req.body?.index) ? req.body.index : undefined,
      url: typeof req.body?.url === 'string' ? req.body.url : undefined,
      urlContains: typeof req.body?.urlContains === 'string' ? req.body.urlContains : undefined
    }));
  } catch (error) {
    sendNetworkError(res, error, 'NETWORK_TARGET_BIND_FAILED');
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
    sendNetworkError(res, error, 'NETWORK_OPEN_FRESH_FAILED');
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
    sendNetworkError(res, error, 'NETWORK_OPEN_FAILED');
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
    sendNetworkError(res, error, 'NETWORK_OPEN_JOB_FAILED');
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
    sendNetworkError(res, error, 'NETWORK_PAGE_CAPTURE_FAILED');
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
    sendNetworkError(res, error, 'NETWORK_READINESS_WAIT_FAILED');
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
    sendNetworkError(res, error, 'NETWORK_INSPECT_FAILED');
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
    sendNetworkError(res, error, 'NETWORK_FORM_EXTRACT_FAILED');
  }
});

app.post('/propose', async (req, res) => {
  try {
    const policy = getPolicy();
    const target = await ensurePage();
    await ensureNotChallenge(target);
    const before = await capturePageArtifact(target, { screenshot: false });
    const requestedFields = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const proposals = requestedFields.map((field, index) => ({
      index,
      name: field?.name || field?.selector || field?.index || `field-${index}`,
      value: field?.value ?? '',
      reason: field?.reason || 'Provided for supervised review before fill'
    }));
    const operationSet = normalizeFillApprovalOperations(requestedFields);
    const operationsHash = approvalPayloadHash(hashStableJson, operationSet);
    const approvalReceipt = await createApprovalReceipt({
      root: policy.approvalReceiptRoot,
      kind: 'fill',
      targetId: before.targetId,
      pageRevision: before.pageRevision,
      formRevision: before.formRevision,
      payloadHash: operationsHash,
      ttlMs: policy.approvalReceiptTtlMs
    });

    res.json({
      ok: true,
      status: 'NETWORK_PROPOSAL_READY',
      url: before.url,
      title: before.title,
      targetId: before.targetId,
      pageRevision: before.pageRevision,
      formRevision: before.formRevision,
      operationsHash,
      approvalReceipt,
      proposals
    });
  } catch (error) {
    sendNetworkError(res, error, 'NETWORK_PROPOSAL_FAILED');
  }
});

app.post('/fill-after-approval', async (req, res) => {
  const correlation = normalizeExecutionCorrelation(req.body);
  try {
    const policy = getPolicy();
    const approved = req.body?.approved === true;
    const approvalText = String(req.body?.approvalText || '');
    if (policy.requireApprovalForFill && (!approved || approvalText !== 'APPLY')) {
      throw revisionError('NETWORK_APPROVAL_REQUIRED', 'Explicit approvalText=APPLY is required for fill actions.');
    }

    const requestedFields = Array.isArray(req.body?.fields) ? req.body.fields : [];
    if (formFillCount >= policy.maxFormFills) {
      throw revisionError('NETWORK_OPERATION_LIMIT_REACHED', 'Form fill limit reached for this supervised session.', { limit: policy.maxFormFills, kind: 'form-fill' });
    }

    if (fieldWriteCount + requestedFields.length > policy.maxFieldWrites) {
      throw revisionError('NETWORK_OPERATION_LIMIT_REACHED', 'Field write limit would be exceeded for this supervised session.', { limit: policy.maxFieldWrites, kind: 'field-write', requestedWrites: requestedFields.length });
    }

    const target = await ensurePage();
    await ensureNotChallenge(target);
    const before = await capturePageArtifact(target, { screenshot: false });
    assertExpectedRevisions(expectedRevisionsFromBody(req.body), before);
    const fields = before.fields;
    const operationSet = normalizeFillApprovalOperations(requestedFields);
    const operationsHash = approvalPayloadHash(hashStableJson, operationSet);
    const approvalReceipt = policy.requireApprovalReceiptForFill
      ? await consumeApprovalReceipt({
          root: policy.approvalReceiptRoot,
          id: req.body?.approvalReceiptId,
          kind: 'fill',
          targetId: before.targetId,
          pageRevision: before.pageRevision,
          formRevision: before.formRevision,
          payloadHash: operationsHash
        })
      : null;

    const filled = [];
    for (const item of requestedFields) {
      const resolved = await resolveRequestedFieldLocator(target, item, fields);
      const evidence = await writeField(target, resolved.locator, item.value, resolved.field);
      filled.push({
        controlId: resolved.field.controlId || item.controlId || null,
        requested: item.name || item.selector || item.index || item.controlId,
        evidence,
      });
    }

    formFillCount += 1;
    fieldWriteCount += requestedFields.length;
    const after = await capturePageArtifact(target, { screenshot: false });

    res.json({
      ok: true,
      status: 'NETWORK_FORM_MUTATION_VERIFIED',
      correlation,
      approvalReceipt,
      operationsHash,
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
    sendNetworkError(res, error, 'NETWORK_FORM_MUTATION_FAILED', correlation);
  }
});

app.post('/upload-artifact', async (req, res) => {
  const correlation = normalizeExecutionCorrelation(req.body);
  try {
    const policy = getPolicy();
    const approved = req.body?.approved === true;
    const approvalText = String(req.body?.approvalText || '');
    if (policy.requireApprovalForUpload && (!approved || approvalText !== 'UPLOAD')) {
      throw revisionError('NETWORK_APPROVAL_REQUIRED', 'Explicit approvalText=UPLOAD is required for file upload actions.');
    }

    const target = await ensurePage();
    await ensureNotChallenge(target);
    const before = await capturePageArtifact(target, { screenshot: false });
    assertExpectedRevisions(expectedRevisionsFromBody(req.body), before);

    const resolvedControl = await resolveUploadControl(target, {
      controlId: req.body?.controlId,
      selector: req.body?.selector
    }, before.fields);

    const guarded = await resolveGuardedUploadArtifact({
      artifactRef: req.body?.artifactRef,
      uploadRoot: policy.uploadRoot,
      expectedSha256: req.body?.expectedSha256,
      maxBytes: policy.maxUploadBytes
    });

    await resolvedControl.locator.setInputFiles(guarded.filePath);
    const uploaded = await resolvedControl.locator.evaluate(node => Array.from(node.files || []).map(file => ({
      name: String(file.name || ''),
      size: Number(file.size || 0),
      type: String(file.type || '')
    })));

    const matched = uploaded.find(file => file.name === guarded.artifact.filename && file.size === guarded.artifact.size);
    if (!matched) {
      throw revisionError(
        'NETWORK_VALIDATION_FAILED',
        'File upload postcondition did not confirm the expected file name and size.',
        {
          controlId: resolvedControl.field.controlId || null,
          expectedFilename: guarded.artifact.filename,
          expectedSize: guarded.artifact.size,
          uploaded
        }
      );
    }

    const after = await capturePageArtifact(target, { screenshot: false });
    res.json({
      ok: true,
      status: 'NETWORK_UPLOAD_VERIFIED',
      correlation,
      controlId: resolvedControl.field.controlId || null,
      artifact: guarded.artifact,
      uploaded: {
        filename: matched.name,
        size: matched.size,
        type: matched.type
      },
      before: {
        targetId: before.targetId,
        pageRevision: before.pageRevision,
        formRevision: before.formRevision
      },
      after: {
        targetId: after.targetId,
        pageRevision: after.pageRevision,
        formRevision: after.formRevision
      }
    });
  } catch (error) {
    sendNetworkError(res, error, 'NETWORK_UPLOAD_FAILED', correlation);
  }
});

app.post('/click', async (req, res) => {
  const correlation = normalizeExecutionCorrelation(req.body);
  try {
    const target = await ensurePage();
    await ensureNotChallenge(target);
    const before = await capturePageArtifact(target, { screenshot: false });
    assertExpectedRevisions(expectedRevisionsFromBody(req.body), before);
    const text = String(req.body?.text || '').trim();
    const selector = String(req.body?.selector || '').trim();
    const nth = Number.isInteger(req.body?.nth) && req.body.nth >= 0 ? req.body.nth : 0;
    if (!text && !selector) {
      throw revisionError('NETWORK_CLICK_TARGET_REQUIRED', 'Either text or selector is required for click.');
    }
    if (/submit|final|delete|withdraw|payment|purchase|confirm/i.test(text)) {
      throw revisionError('NETWORK_FINAL_ACTION_REQUIRES_SUBMIT_TOOL', 'Final submit or destructive clicks are not allowed through network.click.');
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
      throw revisionError('NETWORK_FIELD_NOT_FOUND', 'Click target was not found at the requested index.', { count, nth, selector: selector || null, text: text || null });
    }
    await locator.nth(nth).click();
    await target.bringToFront().catch(() => {});
    await target.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await ensureNotChallenge(target);
    const initialAfter = await capturePageArtifact(target, { screenshot: false });
    const settled = await settleClickTransition({
      before,
      initialAfter,
      capture: () => capturePageArtifact(target, { screenshot: false })
    });
    const { after, transition } = settled;
    const verified = Object.values(transition).some(Boolean);
    res.json({
      ok: verified,
      status: verified ? 'NETWORK_CLICK_TRANSITION_VERIFIED' : 'NETWORK_CLICK_POSTCONDITION_UNVERIFIED',
      verified,
      retrySafe: false,
      externalActionMayHaveOccurred: true,
      correlation,
      clicked: selector || text,
      nth,
      settling: {
        observedDelayedTransition: settled.settled,
        elapsedMs: settled.elapsedMs
      },
      transition,
      before: {
        targetId: before.targetId,
        pageRevision: before.pageRevision,
        formRevision: before.formRevision,
        url: before.url
      },
      after: {
        targetId: after.targetId,
        pageRevision: after.pageRevision,
        formRevision: after.formRevision,
        url: after.url,
        title: after.title
      },
      recommendedAction: verified
        ? 'Continue from the returned target/page/form revisions.'
        : 'Inspect the current page before deciding the next action. Do not automatically repeat the click.'
    });
  } catch (error) {
    sendNetworkError(res, error, 'NETWORK_CLICK_FAILED', correlation);
  }
});

app.post('/review-before-submit', async (_req, res) => {
  try {
    const policy = getPolicy();
    const target = await ensurePage();
    await ensureNotChallenge(target);
    const artifact = await capturePageArtifact(target, { screenshot: true, screenshotPrefix: 'review' });
    const reviewPayloadHash = approvalPayloadHash(hashStableJson, { reviewHash: artifact.reviewHash });
    const approvalReceipt = await createApprovalReceipt({
      root: policy.approvalReceiptRoot,
      kind: 'submit',
      targetId: artifact.targetId,
      pageRevision: artifact.pageRevision,
      formRevision: artifact.formRevision,
      payloadHash: reviewPayloadHash,
      ttlMs: policy.approvalReceiptTtlMs
    });
    res.json({
      ...artifact,
      status: 'NETWORK_REVIEW_READY',
      reviewPayloadHash,
      approvalReceipt,
      message: 'Review manually before submit. Approve only this exact review receipt/revision before final submit.'
    });
  } catch (error) {
    sendNetworkError(res, error, 'NETWORK_REVIEW_CAPTURE_FAILED');
  }
});

app.post('/submit-after-approval', async (req, res) => {
  const correlation = normalizeExecutionCorrelation(req.body);
  try {
    const policy = getPolicy();
    const approved = req.body?.approved === true;
    const approvalText = String(req.body?.approvalText || '');
    if (!policy.submitEnabled) {
      throw revisionError('NETWORK_SUBMIT_DISABLED', 'Final submit is disabled by Network policy.');
    }
    if (policy.requireApprovalForSubmit && (!approved || approvalText !== 'SUBMIT')) {
      throw revisionError('NETWORK_APPROVAL_REQUIRED', 'Explicit approvalText=SUBMIT is required for final submit actions.');
    }

    const target = await ensurePage();
    await ensureNotChallenge(target);
    const before = await capturePageArtifact(target, { screenshot: false });
    assertExpectedRevisions(expectedRevisionsFromBody(req.body), before);
    const expectedReviewHash = String(req.body?.reviewHash || '').trim();
    if (expectedReviewHash && expectedReviewHash !== before.reviewHash) {
      throw revisionError('NETWORK_APPROVAL_STALE', 'Current page review revision does not match the approved review artifact. Capture a fresh review artifact before submitting.', { expectedReviewHash, actualReviewHash: before.reviewHash });
    }
    const reviewPayloadHash = approvalPayloadHash(hashStableJson, { reviewHash: before.reviewHash });
    const approvalReceipt = policy.requireApprovalReceiptForSubmit
      ? await consumeApprovalReceipt({
          root: policy.approvalReceiptRoot,
          id: req.body?.approvalReceiptId,
          kind: 'submit',
          targetId: before.targetId,
          pageRevision: before.pageRevision,
          formRevision: before.formRevision,
          payloadHash: reviewPayloadHash
        })
      : null;

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
    const postSubmitText = await target.evaluate(() => String(document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20000));
    const postcondition = classifySubmitPostcondition({ before, after, visibleText: postSubmitText });
    res.json({
      ...postcondition,
      action: 'submit_after_approval',
      correlation,
      approvalReceipt,
      reviewPayloadHash,
      clicked: selector || text || 'default-submit',
      nth,
      beforeReviewHash: before.reviewHash,
      after,
      recommendedAction: postcondition.verified
        ? 'Submission confirmation was detected. Preserve the returned evidence.'
        : 'Inspect the current page and resolve validation or confirmation uncertainty. Do not automatically repeat submit.'
    });
  } catch (error) {
    sendNetworkError(res, error, 'NETWORK_SUBMIT_FAILED', correlation);
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

