export class CareerToolRegistry {
  constructor(workerUrl, browserWorkerToken = '') {
    this.workerUrl = workerUrl;
    this.browserWorkerToken = browserWorkerToken;
  }

  listTools() {
    return [
      'career.open',
      'career.inspect',
      'career.extract_form',
      'career.propose',
      'career.fill_after_approval',
      'career.review_before_submit'
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
      'career.open': '/open',
      'career.inspect': '/inspect',
      'career.extract_form': '/extract-form',
      'career.propose': '/propose',
      'career.fill_after_approval': '/fill-after-approval',
      'career.review_before_submit': '/review-before-submit'
    };

    const route = routes[toolName];
    if (!route) {
      throw new Error(`Unknown career tool: ${toolName}`);
    }

    return this.callWorker(route, payload);
  }
}
