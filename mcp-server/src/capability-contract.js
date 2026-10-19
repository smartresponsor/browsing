export const webCapabilityAliases = Object.freeze({
  'web.browser.status': 'web.browser_status',
  'web.browser.restart': 'web.browser_restart',
  'web.browser.kill': 'web.browser_kill',
  'web.browser.health': 'web.health_full',
  'web.browser.shared.status': 'web.shared_browser_status',
  'web.browser.cdp.targets': 'web.browser_cdp_targets',
  'web.browser.chatgpt.home.verify': 'web.browser_cdp_verify_chatgpt_home',
  'web.browser.chatgpt.home.cleanup.plan': 'web.browser_cdp_cleanup_plan_chatgpt_home',
  'web.browser.chatgpt.home.cleanup': 'web.browser_cdp_cleanup_chatgpt_home',
  'web.surface.plan': 'web.surface_plan',
  'web.surface.execute': 'web.surface_execute',
  'web.browser.targets': 'web.browser_targets',
  'web.browser.bind': 'web.browser_bind',
  'web.target.open': 'web.open',
  'web.job.open': 'web.open_job',
  'web.chatgpt.snapshot': 'web.chatgpt_snapshot',
  'web.page.capture': 'web.page_capture',
  'web.page.wait': 'web.wait_for_ready',
  'web.page.click': 'web.click',
  'web.form.inspect': 'web.inspect',
  'web.form.extract': 'web.extract_form',
  'web.form.proposal.preview': 'web.propose',
  'web.form.fill': 'web.fill_after_approval',
  'web.form.upload': 'web.upload_artifact',
  'web.form.review.snapshot': 'web.review_before_submit',
  'web.form.submit': 'web.submit_after_approval'
});

export const webCapabilityContract = Object.freeze({
  schemaVersion: 2,
  contractVersion: '2.1.0',
  owner: 'browser-mcp',
  boundary: Object.freeze({
    chatgptFacingConnector: 'console-mcp',
    browserOwner: 'console-mcp',
    executionOwner: 'console-mcp',
    orchestrationOwner: 'console-mcp',
    capabilityOwner: 'browser-mcp',
    domainStateOwner: 'browser-mcp',
    standaloneConnectorRequired: false,
    competingBrowserLaunchAllowed: false,
    genericAsyncLifecycleOwnedByWeb: false,
    genericExecutionLeaseOwnedByWeb: false
  }),
  worker: Object.freeze({
    defaultUrl: 'http://127.0.0.1:8791',
    defaultRemoteDebuggingPort: 9223,
    transport: 'loopback-http',
    browserAttachment: 'console-owned-cdp'
  }),
  tools: Object.freeze([
    tool('web.browser_status', '/browser-status', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'runtime-snapshot'
    }),
    tool('web.browser_restart', '/browser-restart', 'write', {
      riskClass: 'runtime-control', binding: 'optional', replayPolicy: 'non-idempotent', postcondition: 'browser-runtime-ready'
    }),
    tool('web.browser_kill', '/browser-kill', 'write', {
      riskClass: 'runtime-control', binding: 'optional', replayPolicy: 'idempotent', postcondition: 'web-browser-session-closed'
    }),
    tool('web.health_full', '/health-full', 'read', {
      riskClass: 'observation', binding: 'optional', timeoutClass: 'diagnostic', postcondition: 'diagnostic-snapshot'
    }),
    tool('web.shared_browser_status', '/shared-browser-status', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'shared-runtime-snapshot'
    }),
    tool('web.browser_cdp_targets', '/browser-cdp-targets', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'target-inventory'
    }),
    tool('web.browser_cdp_verify_chatgpt_home', '/browser-cdp-verify-chatgpt-home', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'candidate-verification'
    }),
    tool('web.browser_cdp_cleanup_plan_chatgpt_home', '/browser-cdp-cleanup-plan-chatgpt-home', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'cleanup-plan'
    }),
    tool('web.browser_cdp_cleanup_chatgpt_home', '/browser-cdp-cleanup-chatgpt-home', 'write', {
      riskClass: 'destructive-ui', binding: 'optional', approvalPolicy: 'explicit-boolean', replayPolicy: 'idempotent',
      postcondition: 'verified-empty-targets-closed'
    }),
    tool('web.surface_plan', '/connector-sync-plan', 'read', {
      riskClass: 'observation', binding: 'optional', legacyConnectorSurface: true, postcondition: 'connector-refresh-plan'
    }),
    tool('web.surface_execute', '/connector-sync-execute', 'write', {
      riskClass: 'account-session-mutation', binding: 'optional', approvalPolicy: 'explicit-boolean',
      legacyConnectorSurface: true, postcondition: 'connector-refresh-result'
    }),
    tool('web.connector_sync_execute', '/connector-sync-execute', 'write', {
      riskClass: 'account-session-mutation', binding: 'optional', approvalPolicy: 'explicit-boolean',
      visibility: 'internal', legacyConnectorSurface: true, postcondition: 'connector-refresh-result'
    }),
    tool('web.browser_targets', '/browser-targets', 'read', {
      riskClass: 'observation', binding: 'optional', postcondition: 'target-inventory'
    }),
    tool('web.browser_bind', '/browser-bind', 'write', {
      riskClass: 'reversible-ui', binding: 'optional', replayPolicy: 'idempotent', postcondition: 'target-bound'
    }),
    tool('web.open', '/open', 'write', {
      riskClass: 'navigation', binding: 'optional', replayPolicy: 'non-idempotent', postcondition: 'navigation-observed'
    }),
    tool('web.open_job', '/open-job', 'write', {
      riskClass: 'navigation', binding: 'optional', replayPolicy: 'non-idempotent', postcondition: 'navigation-observed'
    }),
    tool('web.open_fresh', '/open-fresh', 'write', {
      riskClass: 'navigation', binding: 'optional', replayPolicy: 'non-idempotent', visibility: 'internal',
      postcondition: 'new-target-opened'
    }),
    tool('web.chatgpt_snapshot', '/chatgpt-snapshot', 'read', {
      riskClass: 'observation', binding: 'required', postcondition: 'chatgpt-snapshot'
    }),
    tool('web.page_capture', '/page-capture', 'read', {
      riskClass: 'observation', binding: 'required', artifactBehavior: 'optional-screenshot',
      postcondition: 'page-revision-snapshot'
    }),
    tool('web.wait_for_ready', '/wait-for-ready', 'read', {
      riskClass: 'observation', binding: 'required', timeoutClass: 'bounded-wait', postcondition: 'readiness-evidence'
    }),
    tool('web.click', '/click', 'write', {
      riskClass: 'reversible-ui', binding: 'required', replayPolicy: 'non-idempotent',
      executionCorrelation: 'console-owned-optional', postcondition: 'transition-observed-or-explicitly-unverified'
    }),
    tool('web.inspect', '/inspect', 'read', {
      riskClass: 'observation', binding: 'required', postcondition: 'form-snapshot'
    }),
    tool('web.extract_form', '/extract-form', 'read', {
      riskClass: 'observation', binding: 'required', postcondition: 'form-snapshot'
    }),
    tool('web.propose', '/propose', 'write', {
      riskClass: 'local-domain-state', binding: 'required', replayPolicy: 'non-idempotent',
      approvalReceiptBehavior: 'mints-fill-one-time', postcondition: 'proposal-and-fill-approval-receipt-created'
    }),
    tool('web.fill_after_approval', '/fill-after-approval', 'write', {
      riskClass: 'data-entry', binding: 'required', approvalPolicy: 'explicit-apply',
      requiresExplicitApproval: true, replayPolicy: 'non-idempotent', executionCorrelation: 'console-owned-optional',
      approvalReceiptBehavior: 'consumes-fill-one-time', postcondition: 'field-values-verified'
    }),
    tool('web.upload_artifact', '/upload-artifact', 'write', {
      riskClass: 'local-artifact-upload', binding: 'required', approvalPolicy: 'explicit-upload',
      requiresExplicitApproval: true, replayPolicy: 'non-idempotent', artifactBehavior: 'guarded-local-upload',
      executionCorrelation: 'console-owned-optional', postcondition: 'file-name-and-size-verified'
    }),
    tool('web.review_before_submit', '/review-before-submit', 'write', {
      riskClass: 'local-domain-state', binding: 'required', artifactBehavior: 'review-snapshot', replayPolicy: 'non-idempotent',
      approvalReceiptBehavior: 'mints-submit-one-time', postcondition: 'review-revision-and-submit-approval-receipt-created'
    }),
    tool('web.submit_after_approval', '/submit-after-approval', 'write', {
      riskClass: 'final-external-submit', binding: 'required', approvalPolicy: 'explicit-submit',
      requiresExplicitApproval: true, replayPolicy: 'never-replay', timeoutClass: 'long',
      artifactBehavior: 'terminal-evidence', executionCorrelation: 'console-owned-optional',
      approvalReceiptBehavior: 'consumes-submit-one-time', postcondition: 'submit-result-verified-or-explicitly-unverified'
    })
  ])
});

export const webCapabilityRoutes = Object.freeze(
  Object.fromEntries(webCapabilityContract.tools.map((item) => [item.name, item.route]))
);

export const webCapabilityAdmissions = Object.freeze(
  Object.fromEntries(webCapabilityContract.tools.map((item) => [item.name, item.admission]))
);

export function listWebCapabilityToolNames({ publicOnly = false } = {}) {
  const tools = publicOnly
    ? webCapabilityContract.tools.filter((item) => item.visibility !== 'internal')
    : webCapabilityContract.tools;

  return tools.map((item) => item.name);
}

export function getWebCapabilityRoute(toolName) {
  const canonicalName = webCapabilityAliases[toolName] ?? toolName;
  return webCapabilityRoutes[canonicalName] ?? null;
}

export function getWebCapabilityAdmission(toolName) {
  const canonicalName = webCapabilityAliases[toolName] ?? toolName;
  const admission = webCapabilityAdmissions[canonicalName];
  if (!admission || admission.lifecycle === 'retired') {
    throw new Error(`Web capability is not admitted: ${toolName}`);
  }
  return admission;
}

function tool(name, route, risk, metadata = {}) {
  const visibility = metadata.visibility ?? 'public';
  const riskClass = metadata.riskClass ?? (risk === 'read' ? 'observation' : 'reversible-ui');
  const approvalPolicy = metadata.approvalPolicy ?? (metadata.requiresExplicitApproval ? 'explicit' : 'none');

  return Object.freeze({
    name,
    route,
    risk,
    admission: Object.freeze({
      name,
      kind: metadata.kind ?? 'domainCapability',
      risk: risk === 'read' ? 'read_' : 'write',
      consumers: Object.freeze(metadata.consumers ?? ['chatgpt', 'codex', 'runner']),
      lifecycle: metadata.lifecycle ?? 'admitted'
    }),
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
    executionCorrelation: metadata.executionCorrelation ?? 'none',
    approvalReceiptBehavior: metadata.approvalReceiptBehavior ?? 'none',
    postcondition: metadata.postcondition ?? 'result-returned',
    legacyConnectorSurface: metadata.legacyConnectorSurface === true
  });
}
