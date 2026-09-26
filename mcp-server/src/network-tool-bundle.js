import { z } from 'zod';
import { NetworkToolRegistry } from './tool-registry.js';

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

  mcpServer.registerTool(
    'network.chatgpt_snapshot',
    {
      description: 'Read the current supervised ChatGPT Web tab URL and message snapshot for semantic execution gating.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.chatgpt_snapshot', {}))
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
        text: z.string().optional(),
        selector: z.string().optional(),
        nth: z.number().int().nonnegative().optional()
      }).strict()
    },
    async ({ text, selector, nth }) => toolResult(await registry.callTool('network.click', { text, selector, nth }))
  );

  mcpServer.registerTool(
    'network.extract_form',
    {
      description: 'Extract the current form field snapshot.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.extract_form', {}))
  );

  mcpServer.registerTool(
    'network.propose',
    {
      description: 'Produce supervised answer proposals before filling.',
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
        fields: z.array(z.record(z.unknown()))
      }).strict()
    },
    async ({ approved, approvalText, fields }) => toolResult(await registry.callTool('network.fill_after_approval', {
      approved,
      approvalText,
      fields
    }))
  );

  mcpServer.registerTool(
    'network.review_before_submit',
    {
      description: 'Capture a manual review artifact before any final submit.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.review_before_submit', {}))
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
