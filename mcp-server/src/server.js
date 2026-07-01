import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { NetworkToolRegistry } from './tool-registry.js';

const host = process.env.NETWORK_MCP_SERVER_HOST || '127.0.0.1';
const port = Number(process.env.NETWORK_MCP_SERVER_PORT || 8792);
const endpoint = process.env.NETWORK_MCP_SERVER_ENDPOINT || '/mcp';
const workerUrl = process.env.NETWORK_MCP_BROWSER_WORKER_URL || 'http://127.0.0.1:8791';
const upstreamToken = process.env.NETWORK_MCP_UPSTREAM_TOKEN || '';
const upstreamPreviousToken = process.env.NETWORK_MCP_UPSTREAM_TOKEN_PREVIOUS || '';

const registry = new NetworkToolRegistry(
  workerUrl,
  process.env.NETWORK_MCP_BROWSER_WORKER_TOKEN || ''
);

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Missing request URL.');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      service: 'network-mcp',
      endpoint
    }));
    return;
  }

  const requestPath = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  const endpointPath = endpoint === '/' ? '/' : endpoint.replace(/\/+$/, '');
  if (requestPath !== endpointPath && !(req.method === 'POST' && requestPath === '/')) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found.');
    return;
  }

  if (upstreamToken) {
    const auth = String(req.headers.authorization || '');
    const acceptedTokens = [upstreamToken, upstreamPreviousToken].filter(Boolean);
    if (!acceptedTokens.some((token) => auth === `Bearer ${token}`)) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }
  }

  if (req.method !== 'POST') {
    res.writeHead(405, {
      'content-type': 'application/json; charset=utf-8',
      allow: 'POST'
    });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.'
      },
      id: null
    }));
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  const mcpServer = buildServer();
  ensureStreamableHttpAcceptHeader(req);

  try {
    await mcpServer.connect(transport);
    const body = await readJsonBody(req);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error)
        },
        id: null
      }));
    }
  } finally {
    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
  }
});

server.listen(port, host, () => {
  console.log(`network-mcp listening on http://${host}:${port}${endpoint}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

function buildServer() {
  const mcpServer = new McpServer({
    name: 'network-mcp',
    version: '0.1.0-rc2'
  });

  registerNetworkTools(mcpServer);

  return mcpServer;
}

function registerNetworkTools(mcpServer) {
  mcpServer.registerTool(
    'network.browser_status',
    {
      description: 'Inspect the supervised browser runtime state.',
      inputSchema: z.object({}).strict()
    },
    async () => toolResult(await registry.callTool('network.browser_status', {}))
  );

  mcpServer.registerTool(
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

  mcpServer.registerTool(
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

  mcpServer.registerTool(
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

  mcpServer.registerTool(
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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw);
}

function ensureStreamableHttpAcceptHeader(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  const jsonMediaType = 'application' + '/' + 'json';
  const streamMediaType = 'text' + '/' + 'event' + '-' + 'stream';

  if (accept.includes(jsonMediaType) && accept.includes(streamMediaType)) {
    return;
  }

  req.headers.accept = jsonMediaType + ', ' + streamMediaType;
}
