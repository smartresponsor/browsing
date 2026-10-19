import { z } from 'zod';
import { registerWebCoreDomainToolDefinitions } from './web-domain-tool-definitions.js';
import { WebToolRegistry } from './tool-registry.js';

const webExecutionCorrelationSchema = z.object({
  taskId: z.string().min(1).max(200).optional(),
  runId: z.string().min(1).max(200).optional(),
  invocationId: z.string().min(1).max(200).optional(),
}).strict();

export function createWebToolBundle({ workerUrl, browserWorkerToken }) {
  const registry = new WebToolRegistry(workerUrl, browserWorkerToken || '');

  return {
    name: 'web-tool-bundle',
    register(mcpServer) {
      registerBrowserTools(mcpServer, registry);
    }
  };
}

function registerBrowserTool(mcpServer, canonicalName, legacyNames, config, handler) {
  mcpServer.registerTool(canonicalName, config, handler);
  for (const legacyName of [...new Set(legacyNames.filter((name) => Boolean(name) && name !== canonicalName))]) {
    mcpServer.registerTool(legacyName, config, handler);
  }
}

function registerBrowserTools(mcpServer, registry) {
  registerBrowserTool(
    mcpServer,
    'web.browser.status',
    ['web.browser.status', 'web.browser_status'],
    {
      description: 'Inspect the supervised browser runtime state.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('web.browser_status', {}))
  );

  registerBrowserTool(
    mcpServer,
    'web.browser.restart',
    ['web.browser.restart', 'web.browser_restart'],
    {
      description: 'Restart the supervised browser session.',
      inputSchema: z.object({
        hard: z.boolean().optional(),
        reopen: z.boolean().optional(),
        reason: z.string().max(200).optional()
      }).strict()
    },
    async ({ hard, reopen, reason }) => toolResult(await registry.callTool('web.browser_restart', {
      force: hard === true,
      reopen,
      reason
    }))
  );

  registerBrowserTool(
    mcpServer,
    'web.browser.kill',
    ['web.browser.kill', 'web.browser_kill'],
    {
      description: 'Close the supervised browser session and kill managed browser processes for the configured profile.',
      inputSchema: z.object({
        reason: z.string().max(200).optional()
      }).strict()
    },
    async ({ reason }) => toolResult(await registry.callTool('web.browser_kill', { reason }))
  );

  registerBrowserTool(
    mcpServer,
    'web.browser.health',
    ['web.health_full'],
    {
      description: 'Run deep supervised browser diagnostics including worker, browser, target, profile, and DevTools reachability.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('web.health_full', {}))
  );

  registerBrowserTool(
    mcpServer,
    'web.browser.shared.status',
    ['web.shared_browser_status'],
    {
      description: 'Read the shared Edge-first browser runtime registry and live CDP attachment status.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('web.shared_browser_status', {}))
  );

  registerBrowserTool(
    mcpServer,
    'web.browser.cdp.targets',
    ['web.browser_cdp_targets'],
    {
      description: 'List raw shared browser CDP targets without attaching through Playwright or opening pages.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('web.browser_cdp_targets', {}))
  );

  registerBrowserTool(
    mcpServer,
    'web.browser.chatgpt.home.verify',
    ['web.browser_cdp_verify_chatgpt_home'],
    {
      description: 'Verify raw ChatGPT home CDP cleanup candidates by reading DOM composer state without writing, clicking, closing, or using Playwright attach.',
      inputSchema: z.object({
        index: z.number().int().nonnegative().optional(),
        id: z.string().optional(),
        maxVerify: z.number().int().min(1).max(50).optional(),
        timeoutMs: z.number().int().min(250).max(10000).optional()
      }).strict()
    },
    async ({ index, id, maxVerify, timeoutMs }) => toolResult(await registry.callTool('web.browser_cdp_verify_chatgpt_home', { index, id, maxVerify, timeoutMs }))
  );

  registerBrowserTool(
    mcpServer,
    'web.browser.chatgpt.home.cleanup.plan',
    ['web.browser_cdp_cleanup_plan_chatgpt_home'],
    {
      description: 'Build a read-only dry-run cleanup plan for verified empty ChatGPT home CDP targets.',
      inputSchema: z.object({
        maxVerify: z.number().int().min(1).max(50).optional(),
        maxClose: z.number().int().min(1).max(50).optional(),
        timeoutMs: z.number().int().min(250).max(10000).optional()
      }).strict()
    },
    async ({ maxVerify, maxClose, timeoutMs }) => toolResult(await registry.callTool('web.browser_cdp_cleanup_plan_chatgpt_home', { maxVerify, maxClose, timeoutMs }))
  );

  registerBrowserTool(
    mcpServer,
    'web.browser.chatgpt.home.cleanup',
    ['web.browser_cdp_cleanup_chatgpt_home'],
    {
      description: 'Close only verified empty ChatGPT home CDP targets after explicit confirmation, then verify conversation tabs were preserved.',
      inputSchema: z.object({
        confirmCleanup: z.boolean().default(false),
        maxVerify: z.number().int().min(1).max(50).optional(),
        maxClose: z.number().int().min(1).max(10).optional(),
        timeoutMs: z.number().int().min(250).max(10000).optional()
      }).strict()
    },
    async ({ confirmCleanup, maxVerify, maxClose, timeoutMs }) => toolResult(await registry.callTool('web.browser_cdp_cleanup_chatgpt_home', { confirmCleanup, maxVerify, maxClose, timeoutMs }))
  );

  registerBrowserTool(
    mcpServer,
    'web.surface.plan',
    ['web.surface_plan'],
    {
      description: 'Build a read-only publication update plan for browser-mcp.',
      inputSchema: z.object({
        connectorName: z.string().optional(),
        connectorId: z.string().optional(),
        timeoutMs: z.number().int().min(5000).max(120000).optional()
      }).strict()
    },
    async ({ connectorName, connectorId, timeoutMs }) => toolResult(await registry.callTool('web.surface_plan', { connectorName, connectorId, timeoutMs }))
  );

  registerBrowserTool(
    mcpServer,
    'web.surface.execute',
    ['web.surface_execute'],
    {
      description: 'Run the approved publication update for browser-mcp.',
      inputSchema: z.object({
        confirmSync: z.boolean().default(false),
        connectorName: z.string().optional(),
        connectorId: z.string().optional(),
        timeoutMs: z.number().int().min(5000).max(120000).optional()
      }).strict()
    },
    async ({ confirmSync, connectorName, connectorId, timeoutMs }) => toolResult(await registry.callTool('web.connector_sync_execute', {
      confirmRefresh: confirmSync === true,
      connectorName,
      connectorId,
      timeoutMs
    }))
  );

  registerWebCoreDomainToolDefinitions(mcpServer, registry);
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
