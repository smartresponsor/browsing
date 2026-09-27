export const networkCapabilityAliases = Object.freeze({
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

export const networkCapabilityContract = Object.freeze({
  schemaVersion: 2,
  contractVersion: '2.0.0',
  owner: 'network-mcp',
  boundary: Object.freeze({
    chatgptFacingConnector: 'console-mcp',
    browserOwner: 'console-mcp',
    capabilityOwner: 'network-mcp',
    standaloneConnectorRequired: false,
    competingBrowserLaunchAllowed: false
  }),
  worker: Object.freeze({
    defaultUrl: 'http://127.0.0.1:8791',
    defaultRemoteDebuggingPort: 9223,
    transport: 'loopback-http',
    browserAttachment: 'console-owned-cdp'
  }),
  tools: Object.freeze([
    tool('network.browser_status', '/browser-status', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'runtime-snapshot'
    }),
    tool('network.browser_restart', '/browser-restart', 'write', {
      riskClass: 'runtime-control', binding: 'optional', replayPolicy: 'non-idempotent', postcondition: 'browser-runtime-ready'
    }),
    tool('network.browser_kill', '/browser-kill', 'write', {
      riskClass: 'runtime-control', binding: 'optional', replayPolicy: 'idempotent', postcondition: 'network-browser-session-closed'
    }),
    tool('network.health_full', '/health-full', 'read', {
      riskClass: 'observation', binding: 'optional', timeoutClass: 'diagnostic', postcondition: 'diagnostic-snapshot'
    }),
    tool('network.shared_browser_status', '/shared-browser-status', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'shared-runtime-snapshot'
    }),
    tool('network.browser_cdp_targets', '/browser-cdp-targets', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'target-inventory'
    }),
    tool('network.browser_cdp_verify_chatgpt_home', '/browser-cdp-verify-chatgpt-home', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'candidate-verification'
    }),
    tool('network.browser_cdp_cleanup_plan_chatgpt_home', '/browser-cdp-cleanup-plan-chatgpt-home', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'cleanup-plan'
    }),
    tool('network.browser_cdp_cleanup_chatgpt_home', '/browser-cdp-cleanup-chatgpt-home', 'write', {
      riskClass: 'destructive-ui', binding: 'optional', approvalPolicy: 'explicit-boolean', replayPolicy: 'idempotent',
      postcondition: 'verified-empty-targets-closed'
    }),
    tool('network.surface_plan', '/connector-sync-plan', 'read', {
      riskClass: 'observation', binding: 'optional', legacyConnectorSurface: true, postcondition: 'connector-refresh-plan'
    }),
    tool('network.surface_execute', '/connector-sync-execute', 'write', {
      riskClass: 'account-session-mutation', binding: 'optional', approvalPolicy: 'explicit-boolean',
      legacyConnectorSurface: true, postcondition: 'connector-refresh-result'
    }),
    tool('network.connector_sync_execute', '/connector-sync-execute', 'write', {
      riskClass: 'account-session-mutation', binding: 'optional', approvalPolicy: 'explicit-boolean',
      visibility: 'internal', legacyConnectorSurface: true, postcondition: 'connector-refresh-result'
    }),
    tool('network.browser_targets', '/browser-targets', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'target-inventory'
    }),
    tool('network.browser_bind', '/browser-bind', 'write', {
      riskClass: 'reversible-ui', binding: 'optional', replayPolicy: 'idempotent', postcondition: 'target-bound'
    }),
    tool('network.open', '/open', 'write', {
      riskClass: 'navigation', binding: 'optional', replayPolicy: 'non-idempotent', postcondition: 'navigation-observed'
    }),
    tool('network.open_job', '/open-job', 'write', {
      riskClass: 'navigation', binding: 'optional', replayPolicy: 'non-idempotent', postcondition: 'navigation-observed'
    }),
    tool('network.open_fresh', '/open-fresh', 'write', {
      riskClass: 'navigation', binding: 'optional', replayPolicy: 'non-idempotent', visibility: 'internal',
      postcondition: 'new-target-opened'
    }),
    tool('network.chatgpt_snapshot', '/chatgpt-snapshot', 'read', {
      riskClass: 'observation', binding: 'required', postcondition: 'chatgpt-snapshot'
    }),
    tool('network.page_capture', '/page-capture', 'read', {
      riskClass: 'observation', binding: 'required', artifactBehavior: 'optional-screenshot',
      postcondition: 'page-revision-snapshot'
    }),
    tool('network.wait_for_ready', '/wait-for-ready', 'read', {
      riskClass: 'observation', binding: 'required', timeoutClass: 'bounded-wait', postcondition: 'readiness-evidence'
    }),
    tool('network.click', '/click', 'write', {
      riskClass: 'reversible-ui', binding: 'required', replayPolicy: 'non-idempotent', postcondition: 'transition-observed'
    }),
    tool('network.inspect', '/inspect', 'read', {
      riskClass: 'observation', binding: 'required', postcondition: 'form-snapshot'
    }),
    tool('network.extract_form', '/extract-form', 'read', {
      riskClass: 'observation', binding: 'required', postcondition: 'form-snapshot'
    }),
    tool('network.propose', '/propose', 'read', {
      riskClass: 'observation', binding: 'required', postcondition: 'proposal-set'
    }),
    tool('network.fill_after_approval', '/fill-after-approval', 'write', {
      riskClass: 'data-entry', binding: 'required', approvalPolicy: 'explicit-apply',
      requiresExplicitApproval: true, replayPolicy: 'non-idempotent', postcondition: 'field-values-verified'
    }),
    tool('network.review_before_submit', '/review-before-submit', 'read', {
      riskClass: 'observation', binding: 'required', artifactBehavior: 'review-snapshot',
      postcondition: 'review-revision-created'
    }),
    tool('network.submit_after_approval', '/submit-after-approval', 'write', {
      riskClass: 'final-external-submit', binding: 'required', approvalPolicy: 'explicit-submit',
      requiresExplicitApproval: true, replayPolicy: 'never-replay', timeoutClass: 'long',
      artifactBehavior: 'terminal-evidence', postcondition: 'submit-result-verified-or-explicitly-unverified'
    })
  ])
});

export const networkCapabilityRoutes = Object.freeze(
  Object.fromEntries(networkCapabilityContract.tools.map((item) => [item.name, item.route]))
);

export function listNetworkCapabilityToolNames({ publicOnly = false } = {}) {
  const tools = publicOnly
    ? networkCapabilityContract.tools.filter((item) => item.visibility !== 'internal')
    : networkCapabilityContract.tools;

  return tools.map((item) => item.name);
}

export function getNetworkCapabilityRoute(toolName) {
  const canonicalName = networkCapabilityAliases[toolName] ?? toolName;
  return networkCapabilityRoutes[canonicalName] ?? null;
}

function tool(name, route, risk, metadata = {}) {
  const visibility = metadata.visibility ?? 'public';
  const riskClass = metadata.riskClass ?? (risk === 'read' ? 'observation' : 'reversible-ui');
  const approvalPolicy = metadata.approvalPolicy ?? (metadata.requiresExplicitApproval ? 'explicit' : 'none');

  return Object.freeze({
    name,
    route,
    risk,
    riskClass,
    visibility,
    inputSchemaId: `${name}.input.v1`,
    resultSchemaId: `${name}.result.v1`,
    approvalPolicy,
    requiresExplicitApproval: metadata.requiresExplicitApproval === true,
    binding: metadata.binding ?? 'optional',
    replayPolicy: metadata.replayPolicy ?? (risk === 'read' ? 'safe-replay' : 'non-idempotent'),
    timeoutClass: metadata.timeoutClass ?? 'short',
    artifactBehavior: metadata.artifactBehavior ?? 'none',
    postcondition: metadata.postcondition ?? 'result-returned',
    legacyConnectorSurface: metadata.legacyConnectorSurface === true
  });
}
