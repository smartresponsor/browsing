import { z } from 'zod';
import { NetworkToolRegistry } from './tool-registry.js';

const networkExecutionCorrelationSchema = z.object({
  taskId: z.string().min(1).max(200).optional(),
  runId: z.string().min(1).max(200).optional(),
  invocationId: z.string().min(1).max(200).optional(),
}).strict();

export function createNetworkToolBundle({ workerUrl, browserWorkerToken }) {
  const registry = new NetworkToolRegistry(workerUrl, browserWorkerToken || '');

  return {
    name: 'network-tool-bundle',
    register(mcpServer) {
      registerNetworkTools(mcpServer, registry);
    }
  };
}

function registerNetworkToolWithLegacyAlias(mcpServer, canonicalName, legacyName, config, handler) {
  mcpServer.registerTool(canonicalName, config, handler);
  mcpServer.registerTool(legacyName, config, handler);
}

function registerNetworkTools(mcpServer, registry) {
  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.browser.status',
    'network.browser_status',
    {
      description: 'Inspect the supervised browser runtime state.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.browser_status', {}))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.browser.restart',
    'network.browser_restart',
    {
      description: 'Restart the supervised browser session.',
      inputSchema: z.object({
        hard: z.boolean().optional(),
        reopen: z.boolean().optional(),
        reason: z.string().max(200).optional()
      }).strict()
    },
    async ({ hard, reopen, reason }) => toolResult(await registry.callTool('network.browser_restart', {
      force: hard === true,
      reopen,
      reason
    }))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.browser.kill',
    'network.browser_kill',
    {
      description: 'Close the supervised browser session and kill managed browser processes for the configured profile.',
      inputSchema: z.object({
        reason: z.string().max(200).optional()
      }).strict()
    },
    async ({ reason }) => toolResult(await registry.callTool('network.browser_kill', { reason }))
  );

  mcpServer.registerTool(
    'network.health_full',
    {
      description: 'Run deep supervised browser diagnostics including worker, browser, target, profile, and DevTools reachability.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.health_full', {}))
  );

  mcpServer.registerTool(
    'network.shared_browser_status',
    {
      description: 'Read the shared Edge-first browser runtime registry and live CDP attachment status.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.shared_browser_status', {}))
  );

  mcpServer.registerTool(
    'network.browser_cdp_targets',
    {
      description: 'List raw shared browser CDP targets without attaching through Playwright or opening pages.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.browser_cdp_targets', {}))
  );

  mcpServer.registerTool(
    'network.browser_cdp_verify_chatgpt_home',
    {
      description: 'Verify raw ChatGPT home CDP cleanup candidates by reading DOM composer state without writing, clicking, closing, or using Playwright attach.',
      inputSchema: z.object({
        index: z.number().int().nonnegative().optional(),
        id: z.string().optional(),
        maxVerify: z.number().int().min(1).max(50).optional(),
        timeoutMs: z.number().int().min(250).max(10000).optional()
      }).strict()
    },
    async ({ index, id, maxVerify, timeoutMs }) => toolResult(await registry.callTool('network.browser_cdp_verify_chatgpt_home', { index, id, maxVerify, timeoutMs }))
  );

  mcpServer.registerTool(
    'network.browser_cdp_cleanup_plan_chatgpt_home',
    {
      description: 'Build a read-only dry-run cleanup plan for verified empty ChatGPT home CDP targets.',
      inputSchema: z.object({
        maxVerify: z.number().int().min(1).max(50).optional(),
        maxClose: z.number().int().min(1).max(50).optional(),
        timeoutMs: z.number().int().min(250).max(10000).optional()
      }).strict()
    },
    async ({ maxVerify, maxClose, timeoutMs }) => toolResult(await registry.callTool('network.browser_cdp_cleanup_plan_chatgpt_home', { maxVerify, maxClose, timeoutMs }))
  );

  mcpServer.registerTool(
    'network.browser_cdp_cleanup_chatgpt_home',
    {
      description: 'Close only verified empty ChatGPT home CDP targets after explicit confirmation, then verify conversation tabs were preserved.',
      inputSchema: z.object({
        confirmCleanup: z.boolean().default(false),
        maxVerify: z.number().int().min(1).max(50).optional(),
        maxClose: z.number().int().min(1).max(10).optional(),
        timeoutMs: z.number().int().min(250).max(10000).optional()
      }).strict()
    },
    async ({ confirmCleanup, maxVerify, maxClose, timeoutMs }) => toolResult(await registry.callTool('network.browser_cdp_cleanup_chatgpt_home', { confirmCleanup, maxVerify, maxClose, timeoutMs }))
  );

  mcpServer.registerTool(
    'network.surface_plan',
    {
      description: 'Build a read-only publication update plan for network-mcp.',
      inputSchema: z.object({
        connectorName: z.string().optional(),
        connectorId: z.string().optional(),
        timeoutMs: z.number().int().min(5000).max(120000).optional()
      }).strict()
    },
    async ({ connectorName, connectorId, timeoutMs }) => toolResult(await registry.callTool('network.surface_plan', { connectorName, connectorId, timeoutMs }))
  );

  mcpServer.registerTool(
    'network.surface_execute',
    {
      description: 'Run the approved publication update for network-mcp.',
      inputSchema: z.object({
        confirmSync: z.boolean().default(false),
        connectorName: z.string().optional(),
        connectorId: z.string().optional(),
        timeoutMs: z.number().int().min(5000).max(120000).optional()
      }).strict()
    },
    async ({ confirmSync, connectorName, connectorId, timeoutMs }) => toolResult(await registry.callTool('network.connector_sync_execute', {
      confirmRefresh: confirmSync === true,
      connectorName,
      connectorId,
      timeoutMs
    }))
  );

  mcpServer.registerTool(
    'network.browser_targets',
    {
      description: 'List supervised browser pages with stable indexes, URLs, titles, and active-page identity.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.browser_targets', {}))
  );

  mcpServer.registerTool(
    'network.browser_bind',
    {
      description: 'Bind the supervised worker to a specific browser page by index, exact URL, or URL fragment.',
      inputSchema: z.object({
        index: z.number().int().nonnegative().optional(),
        url: z.string().optional(),
        urlContains: z.string().optional()
      }).strict()
    },
    async ({ index, url, urlContains }) => toolResult(await registry.callTool('network.browser_bind', { index, url, urlContains }))
  );

  mcpServer.registerTool(
    'network.open',
    {
      description: 'Open a target URL in the supervised browser worker.',
      inputSchema: z.object({
        url: z.string().url()
      }).strict()
    },
    async ({ url }) => toolResult(await registry.callTool('network.open', { url }))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.job.open',
    'network.open_job',
    {
      description: 'Open a normalized job URL in the supervised browser worker.',
      inputSchema: z.object({
        url: z.string().url()
      }).strict()
    },
    async ({ url }) => toolResult(await registry.callTool('network.open_job', { url }))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.chatgpt.snapshot',
    'network.chatgpt_snapshot',
    {
      description: 'Read the current supervised ChatGPT Web tab URL and message snapshot for semantic execution gating.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.chatgpt_snapshot', {}))
  );

  mcpServer.registerTool(
    'network.page_capture',
    {
      description: 'Capture the current page URL, title, visible text hash, form hash, submit candidates, and optional screenshot review artifact.',
      inputSchema: z.object({
        screenshot: z.boolean().optional()
      }).strict()
    },
    async ({ screenshot }) => toolResult(await registry.callTool('network.page_capture', { screenshot }))
  );

  mcpServer.registerTool(
    'network.wait_for_ready',
    {
      description: 'Wait for event-driven browser readiness such as DOM content, selector visibility, network idle, or mutation quietness.',
      inputSchema: z.object({
        selector: z.string().optional(),
        state: z.enum(['domcontentloaded', 'load', 'networkidle', 'selector-visible', 'selector-attached', 'mutation-quiet']).optional(),
        timeoutMs: z.number().int().min(250).max(60000).optional(),
        quietMs: z.number().int().min(100).max(10000).optional()
      }).strict()
    },
    async ({ selector, state, timeoutMs, quietMs }) => toolResult(await registry.callTool('network.wait_for_ready', { selector, state, timeoutMs, quietMs }))
  );

  mcpServer.registerTool(
    'network.inspect',
    {
      description: 'Inspect visible form fields in the current page.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.inspect', {}))
  );

  mcpServer.registerTool(
    'network.click',
    {
      description: 'Click a non-final visible button or link in the supervised browser worker.',
      inputSchema: z.object({
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: networkExecutionCorrelationSchema.optional(),
        text: z.string().optional(),
        selector: z.string().optional(),
        nth: z.number().int().nonnegative().optional()
      }).strict()
    },
    async ({ expectedTargetId, expectedPageRevision, expectedFormRevision, correlation, text, selector, nth }) => toolResult(await registry.callTool('network.click', {
      expectedTargetId,
      expectedPageRevision,
      expectedFormRevision,
      correlation,
      text,
      selector,
      nth
    }))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.form.extract',
    'network.extract_form',
    {
      description: 'Extract the current form field snapshot.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.extract_form', {}))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.form.proposal.preview',
    'network.propose',
    {
      description: 'Preview normalized supervised answer proposals before filling.',
      inputSchema: z.object({
        fields: z.array(z.record(z.unknown()))
      }).strict()
    },
    async ({ fields }) => toolResult(await registry.callTool('network.propose', { fields }))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.form.fill',
    'network.fill_after_approval',
    {
      description: 'Fill approved fields only after explicit approval.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: networkExecutionCorrelationSchema.optional(),
        fields: z.array(z.record(z.unknown()))
      }).strict()
    },
    async ({ approved, approvalText, expectedTargetId, expectedPageRevision, expectedFormRevision, correlation, fields }) => toolResult(await registry.callTool('network.fill_after_approval', {
      approved,
      approvalText,
      expectedTargetId,
      expectedPageRevision,
      expectedFormRevision,
      correlation,
      fields
    }))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.form.upload',
    'network.upload_artifact',
    {
      description: 'Upload one approved artifact to an exact file control using a guarded relative artifact reference.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: networkExecutionCorrelationSchema.optional(),
        controlId: z.string().optional(),
        selector: z.string().optional(),
        artifactRef: z.string().min(1),
        expectedSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional()
      }).strict()
    },
    async ({ approved, approvalText, expectedTargetId, expectedPageRevision, expectedFormRevision, correlation, controlId, selector, artifactRef, expectedSha256 }) => toolResult(await registry.callTool('network.upload_artifact', {
      approved,
      approvalText,
      expectedTargetId,
      expectedPageRevision,
      expectedFormRevision,
      correlation,
      controlId,
      selector,
      artifactRef,
      expectedSha256
    }))
  );

  registerNetworkToolWithLegacyAlias(
    mcpServer,
    'network.form.review.snapshot',
    'network.review_before_submit',
    {
      description: 'Capture a manual review artifact before any final submit.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.review_before_submit', {}))
  );

  mcpServer.registerTool(
    'network.submit_after_approval',
    {
      description: 'Perform a final submit/destructive click only after explicit approval and optional review snapshot hash validation.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: networkExecutionCorrelationSchema.optional(),
        reviewHash: z.string().optional(),
        text: z.string().optional(),
        selector: z.string().optional(),
        nth: z.number().int().nonnegative().optional()
      }).strict()
    },
    async ({ approved, approvalText, expectedTargetId, expectedPageRevision, expectedFormRevision, correlation, reviewHash, text, selector, nth }) => toolResult(await registry.callTool('network.submit_after_approval', {
      approved,
      approvalText,
      expectedTargetId,
      expectedPageRevision,
      expectedFormRevision,
      correlation,
      reviewHash,
      text,
      selector,
      nth
    }))
  );
}

function toolResult(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}
