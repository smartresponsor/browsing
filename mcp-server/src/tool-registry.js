import { getNetworkCapabilityRoute, listNetworkCapabilityToolNames } from './capability-contract.js';

const internalWorkerCapabilityNames = new Set([
  'network.open_fresh',
  'network.connector_sync_execute'
]);

const canonicalAliases = Object.freeze({
  'network.browser.status': 'network.browser_status',
  'network.browser.restart': 'network.browser_restart',
  'network.browser.kill': 'network.browser_kill',
  'network.job.open': 'network.open_job',
  'network.chatgpt.snapshot': 'network.chatgpt_snapshot',
  'network.form.extract': 'network.extract_form',
  'network.form.proposal.preview': 'network.propose',
  'network.form.fill': 'network.fill_after_approval',
  'network.form.review.snapshot': 'network.review_before_submit'
});

const workerCapabilityNames = Object.freeze(listNetworkCapabilityToolNames());
const publicToolNames = Object.freeze([
  ...workerCapabilityNames.filter((name) => !internalWorkerCapabilityNames.has(name)),
  ...Object.keys(canonicalAliases)
]);

export class NetworkToolRegistry {
  constructor(workerUrl, browserWorkerToken = '') {
    this.workerUrl = workerUrl;
    this.browserWorkerToken = browserWorkerToken;
  }

  listTools() {
    return [...publicToolNames];
  }

  listWorkerCapabilities() {
    return [...workerCapabilityNames];
  }

  async callWorker(path, payload) {
    const headers = { 'content-type': 'application/json' };
    if (this.browserWorkerToken) {
      headers.authorization = `Bearer ${this.browserWorkerToken}`;
    }

    let response;
    try {
      response = await fetch(`${this.workerUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload ?? {})
      });
    } catch (error) {
      return this.workerUnavailableResult(path, error);
    }

    const bodyText = await response.text();
    const body = parseJsonBody(bodyText);
    if (response.ok) {
      return body ?? { ok: true, body: bodyText };
    }

    return {
      ok: false,
      status: 'NETWORK_BROWSER_WORKER_ERROR',
      worker: {
        ok: false,
        url: this.workerUrl,
        path,
        httpStatus: response.status,
        httpStatusText: response.statusText || ''
      },
      result: body ?? bodyText.slice(0, 2000),
      recommendedAction: 'Inspect the worker response, then restart the Network browser worker if this was not an expected guarded failure.'
    };
  }

  workerUnavailableResult(path, error) {
    return {
      ok: false,
      status: 'NETWORK_BROWSER_WORKER_DOWN',
      worker: {
        ok: false,
        url: this.workerUrl,
        path,
        error: normalizeError(error)
      },
      recommendedAction: 'Start the Network browser worker before using Network MCP browser tools.'
    };
  }

  async callTool(toolName, payload) {
    const workerToolName = canonicalAliases[toolName] ?? toolName;
    const route = getNetworkCapabilityRoute(workerToolName);
    if (!route) {
      throw new Error(`Unknown network tool: ${toolName}`);
    }

    return this.callWorker(route, payload);
  }
}

function parseJsonBody(bodyText) {
  const raw = String(bodyText || '').trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}
