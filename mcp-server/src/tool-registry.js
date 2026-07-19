export class NetworkToolRegistry {
  constructor(workerUrl, browserWorkerToken = '') {
    this.workerUrl = workerUrl;
    this.browserWorkerToken = browserWorkerToken;
  }

  listTools() {
    return [
      'network.browser_status',
      'network.browser_restart',
      'network.browser_kill',
      'network.health_full',
      'network.shared_browser_status',
      'network.browser_cdp_targets',
      'network.browser_cdp_verify_chatgpt_home',
      'network.browser_cdp_cleanup_plan_chatgpt_home',
      'network.browser_cdp_cleanup_chatgpt_home',
      'network.surface_plan',
      'network.surface_execute',
      'network.connector_sync_execute',
      'network.browser_targets',
      'network.browser_bind',
      'network.open',
      'network.open_job',
      'network.open_fresh',
      'network.chatgpt_snapshot',
      'network.page_capture',
      'network.wait_for_ready',
      'network.click',
      'network.inspect',
      'network.extract_form',
      'network.propose',
      'network.fill_after_approval',
      'network.review_before_submit',
      'network.submit_after_approval'
    ];
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
    const routes = {
      'network.browser_status': '/browser-status',
      'network.browser_restart': '/browser-restart',
      'network.browser_kill': '/browser-kill',
      'network.health_full': '/health-full',
      'network.shared_browser_status': '/shared-browser-status',
      'network.browser_cdp_targets': '/browser-cdp-targets',
      'network.browser_cdp_verify_chatgpt_home': '/browser-cdp-verify-chatgpt-home',
      'network.browser_cdp_cleanup_plan_chatgpt_home': '/browser-cdp-cleanup-plan-chatgpt-home',
      'network.browser_cdp_cleanup_chatgpt_home': '/browser-cdp-cleanup-chatgpt-home',
      'network.surface_plan': '/connector-sync-plan',
      'network.surface_execute': '/connector-sync-execute',
      'network.connector_sync_execute': '/connector-sync-execute',
      'network.browser_targets': '/browser-targets',
      'network.browser_bind': '/browser-bind',
      'network.open': '/open',
      'network.open_job': '/open-job',
      'network.open_fresh': '/open-fresh',
      'network.chatgpt_snapshot': '/chatgpt-snapshot',
      'network.page_capture': '/page-capture',
      'network.wait_for_ready': '/wait-for-ready',
      'network.click': '/click',
      'network.inspect': '/inspect',
      'network.extract_form': '/extract-form',
      'network.propose': '/propose',
      'network.fill_after_approval': '/fill-after-approval',
      'network.review_before_submit': '/review-before-submit',
      'network.submit_after_approval': '/submit-after-approval'
    };

    const route = routes[toolName];
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
