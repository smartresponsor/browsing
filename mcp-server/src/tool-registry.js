import {
  getWebCapabilityRoute,
  listWebCapabilityToolNames,
  webCapabilityAliases
} from './capability-contract.js';
import { createWebCoreDomainToolDefinitions } from './web-domain-tool-definitions.js';

const workerCapabilityNames = Object.freeze(listWebCapabilityToolNames());
const coreDomainPublicNames = createWebCoreDomainToolDefinitions().flatMap((tool) => [tool.canonicalName, ...tool.aliases]);
const publicToolNames = Object.freeze([...new Set([
  ...listWebCapabilityToolNames({ publicOnly: true }),
  ...Object.keys(webCapabilityAliases),
  'web.browser.status',
  'web.browser.restart',
  'web.browser.kill',
  ...coreDomainPublicNames
])]);

export class WebToolRegistry {
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
      status: 'WEB_BROWSER_WORKER_ERROR',
      worker: {
        ok: false,
        url: this.workerUrl,
        path,
        httpStatus: response.status,
        httpStatusText: response.statusText || ''
      },
      result: body ?? bodyText.slice(0, 2000),
      recommendedAction: 'Inspect the worker response, then restart the Web browser worker if this was not an expected guarded failure.'
    };
  }

  workerUnavailableResult(path, error) {
    return {
      ok: false,
      status: 'WEB_BROWSER_WORKER_DOWN',
      worker: {
        ok: false,
        url: this.workerUrl,
        path,
        error: normalizeError(error)
      },
      recommendedAction: 'Start the Web browser worker before using Browser MCP browser tools.'
    };
  }

  async callTool(toolName, payload) {
    const route = getWebCapabilityRoute(toolName);
    if (!route) {
      throw new Error(`Unknown Browser MCP tool: ${toolName}`);
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
