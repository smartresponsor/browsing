const publicToolNames = [
  'network.browser.status',
  'network.browser_status',
  'network.browser.restart',
  'network.browser_restart',
  'network.browser.kill',
  'network.browser_kill',
  'network.open',
  'network.job.open',
  'network.open_job',
  'network.chatgpt_snapshot',
  'network.click',
  'network.inspect',
  'network.extract_form',
  'network.propose',
  'network.form.fill',
  'network.fill_after_approval',
  'network.review_before_submit'
];

const internalWorkerCapabilityNames = [
  'network.open_fresh'
];

export class NetworkToolRegistry {
  constructor(workerUrl, browserWorkerToken = '') {
    this.workerUrl = workerUrl;
    this.browserWorkerToken = browserWorkerToken;
  }

  listTools() {
    return [...publicToolNames];
  }

  listWorkerCapabilities() {
    return [...publicToolNames, ...internalWorkerCapabilityNames];
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
      'network.open': '/open',
      'network.open_job': '/open-job',
      'network.open_fresh': '/open-fresh',
      'network.chatgpt_snapshot': '/chatgpt-snapshot',
      'network.click': '/click',
      'network.inspect': '/inspect',
      'network.extract_form': '/extract-form',
      'network.propose': '/propose',
      'network.fill_after_approval': '/fill-after-approval',
      'network.review_before_submit': '/review-before-submit'
    };

    const route = routes[toolName];
    if (!route) {
      throw new Error(`Unknown network tool: ${toolName}`);
    }

    return this.callWorker(route, payload);
  }
}
