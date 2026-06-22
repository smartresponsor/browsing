export class CareerToolRegistry {
  constructor(workerUrl, browserWorkerToken = '') {
    this.workerUrl = workerUrl;
    this.browserWorkerToken = browserWorkerToken;
  }

  listTools() {
    return [
      'network.open',
      'network.inspect',
      'network.extract_form',
      'network.propose',
      'network.fill_after_approval',
      'network.review_before_submit'
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
      throw new Error(`Career worker failed: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }

  async callTool(toolName, payload) {
    const routes = {
      'network.open': '/open',
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
