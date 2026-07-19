export const networkCapabilityContract = Object.freeze({
  schemaVersion: 1,
  owner: 'network-mcp',
  boundary: Object.freeze({
    chatgptFacingConnector: 'console-mcp',
    browserOwner: 'console-mcp',
    capabilityOwner: 'network-mcp',
    standaloneConnectorRequired: false
  }),
  worker: Object.freeze({
    defaultUrl: 'http://127.0.0.1:8791',
    defaultRemoteDebuggingPort: 9223
  }),
  tools: Object.freeze([
    tool('network.browser_status', '/browser-status', 'read'),
    tool('network.browser_restart', '/browser-restart', 'write'),
    tool('network.browser_kill', '/browser-kill', 'write'),
    tool('network.health_full', '/health-full', 'read'),
    tool('network.shared_browser_status', '/shared-browser-status', 'read'),
    tool('network.browser_cdp_targets', '/browser-cdp-targets', 'read'),
    tool('network.browser_cdp_verify_chatgpt_home', '/browser-cdp-verify-chatgpt-home', 'read'),
    tool('network.browser_cdp_cleanup_plan_chatgpt_home', '/browser-cdp-cleanup-plan-chatgpt-home', 'read'),
    tool('network.browser_cdp_cleanup_chatgpt_home', '/browser-cdp-cleanup-chatgpt-home', 'write'),
    tool('network.surface_plan', '/connector-sync-plan', 'read', { legacyConnectorSurface: true }),
    tool('network.surface_execute', '/connector-sync-execute', 'write', { legacyConnectorSurface: true }),
    tool('network.connector_sync_execute', '/connector-sync-execute', 'write', { legacyConnectorSurface: true }),
    tool('network.browser_targets', '/browser-targets', 'read'),
    tool('network.browser_bind', '/browser-bind', 'write'),
    tool('network.open', '/open', 'write'),
    tool('network.open_job', '/open-job', 'write'),
    tool('network.open_fresh', '/open-fresh', 'write'),
    tool('network.chatgpt_snapshot', '/chatgpt-snapshot', 'read'),
    tool('network.page_capture', '/page-capture', 'read'),
    tool('network.wait_for_ready', '/wait-for-ready', 'read'),
    tool('network.click', '/click', 'write'),
    tool('network.inspect', '/inspect', 'read'),
    tool('network.extract_form', '/extract-form', 'read'),
    tool('network.propose', '/propose', 'read'),
    tool('network.fill_after_approval', '/fill-after-approval', 'write', { requiresExplicitApproval: true }),
    tool('network.review_before_submit', '/review-before-submit', 'read'),
    tool('network.submit_after_approval', '/submit-after-approval', 'write', { requiresExplicitApproval: true })
  ])
});

export const networkCapabilityRoutes = Object.freeze(
  Object.fromEntries(networkCapabilityContract.tools.map((item) => [item.name, item.route]))
);

export function listNetworkCapabilityToolNames() {
  return networkCapabilityContract.tools.map((item) => item.name);
}

export function getNetworkCapabilityRoute(toolName) {
  return networkCapabilityRoutes[toolName] ?? null;
}

function tool(name, route, risk, metadata = {}) {
  return Object.freeze({
    name,
    route,
    risk,
    ...metadata
  });
}
