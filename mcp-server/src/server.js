import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createNetworkToolBundle } from './browser-tool-bundle.js';

const host = process.env.BROWSER_MCP_SERVER_HOST || '127.0.0.1';
const port = Number(process.env.BROWSER_MCP_SERVER_PORT || 8792);
const endpoint = process.env.BROWSER_MCP_SERVER_ENDPOINT || '/mcp';
const workerUrl = process.env.BROWSER_MCP_BROWSER_WORKER_URL || 'http://127.0.0.1:8791';
const upstreamToken = process.env.BROWSER_MCP_UPSTREAM_TOKEN || '';
const upstreamPreviousToken = process.env.BROWSER_MCP_UPSTREAM_TOKEN_PREVIOUS || '';

const networkToolBundle = createNetworkToolBundle({
  workerUrl,
  browserWorkerToken: process.env.BROWSER_MCP_BROWSER_WORKER_TOKEN || ''
});

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
      service: 'browser-mcp',
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
  console.log(`browser-mcp listening on http://${host}:${port}${endpoint}`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});

function buildServer() {
  const mcpServer = new McpServer({
    name: 'browser-mcp',
    version: '0.1.0-rc2'
  });

  networkToolBundle.register(mcpServer);

  return mcpServer;
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
