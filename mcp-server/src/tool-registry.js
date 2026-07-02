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

    const response = await fetch(`${this.workerUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload ?? {})
    });

    if (!response.ok) {
      throw new Error(`Network browser worker failed: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }

  async callTool(toolName, payload) {
    const routes = {
      'network.browser_status': '/browser-status',
      'network.browser_restart': '/browser-restart',
      'network.browser_kill': '/browser-kill',
      'network.health_full': '/health-full',
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
