interface Env {
  NETWORK_MCP_TOKEN?: string;
  NETWORK_MCP_WORKER_URL?: string;
  CAREER_WORKER_URL?: string;
  NETWORK_MCP_BROWSER_WORKER_TOKEN?: string;
  NETWORK_MCP_SERVER_URL?: string;
  NETWORK_MCP_UPSTREAM_TOKEN?: string;
  NETWORK_MCP_TOKEN_PREVIOUS?: string;
  NETWORK_MCP_UPSTREAM_TOKEN_PREVIOUS?: string;
  NETWORK_MCP_BROWSER_WORKER_TOKEN_PREVIOUS?: string;
  NETWORK_MCP_AUTH0_ISSUER?: string;
  NETWORK_MCP_OIDC_CLIENT_ID?: string;
  NETWORK_MCP_ALLOWED_EMAIL?: string;
}

const MCP_PROTOCOL_VERSION = '2025-11-25';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  route: string;
};

const MCP_TOOLS: McpTool[] = [
  {
    name: 'network.open',
    description: 'Open a target URL in the supervised browser worker.',
    route: '/open',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Destination URL to open.' }
      },
      required: ['url']
    }
  },
  {
    name: 'network.open_job',
    description: 'Open a normalized job URL in the supervised browser worker.',
    route: '/open-job',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Job-board URL to open.' }
      },
      required: ['url']
    }
  },
  {
    name: 'network.click',
    description: 'Click a non-final visible button or link in the supervised browser worker.',
    route: '/click',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        selector: { type: 'string' },
        nth: { type: 'integer', minimum: 0 }
      }
    }
  },
  {
    name: 'network.inspect',
    description: 'Inspect visible form fields in the current page.',
    route: '/inspect',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'network.extract_form',
    description: 'Extract the current form field snapshot.',
    route: '/extract-form',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  },
  {
    name: 'network.propose',
    description: 'Produce supervised answer proposals before filling.',
    route: '/propose',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true
          }
        }
      },
      required: ['fields']
    }
  },
  {
    name: 'network.fill_after_approval',
    description: 'Fill approved fields only after explicit approval.',
    route: '/fill-after-approval',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        approved: { type: 'boolean' },
        approvalText: { type: 'string' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true
          }
        }
      },
      required: ['approved', 'approvalText', 'fields']
    }
  },
  {
    name: 'network.review_before_submit',
    description: 'Capture a manual review artifact before any final submit.',
    route: '/review-before-submit',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  }
];

function getRequiredEnvValue(env: Env, key: keyof Env): string | null {
  const value = String(env[key] || '').trim();
  if (!value) {
    return null;
  }

  return value;
}

function getAuth0Issuer(env: Env): string | null {
  return getRequiredEnvValue(env, 'NETWORK_MCP_AUTH0_ISSUER');
}

function getOidcClientId(env: Env): string | null {
  return getRequiredEnvValue(env, 'NETWORK_MCP_OIDC_CLIENT_ID');
}

function getAllowedEmail(env: Env): string | null {
  return getRequiredEnvValue(env, 'NETWORK_MCP_ALLOWED_EMAIL');
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function withJsonHeaders(headers: HeadersInit = {}): Headers {
  return new Headers({
    'content-type': 'application/json; charset=utf-8',
    ...headers
  });
}

function getPublicOidcConfig(env: Env) {
  const issuer = getAuth0Issuer(env);
  if (!issuer) {
    return null;
  }

  const authorizationEndpoint = `${issuer}/authorize`;
  const tokenEndpoint = `${issuer}/oauth/token`;
  const userinfoEndpoint = `${issuer}/userinfo`;

  return {
    issuer,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    userinfo_endpoint: userinfoEndpoint,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256', 'plain']
  };
}

function getMcpDebugInfo(env: Env) {
  const auth0IssuerConfigured = Boolean(getAuth0Issuer(env));
  const oidcClientIdConfigured = Boolean(getOidcClientId(env));
  const allowedEmailConfigured = Boolean(getAllowedEmail(env));

  return {
    ok: true,
    service: 'network-mcp',
    protocolVersion: MCP_PROTOCOL_VERSION,
    auth: {
      legacyBearer: true,
      auth0Bearer: true,
      auth0IssuerConfigured,
      oidcClientIdConfigured,
      allowedEmailConfigured
    },
    schemaOwner: 'upstream-mcp-server', networkMcpServerUrlConfigured: Boolean(getMcpServerUrl(env)), upstreamTokenConfigured: Boolean(getRequiredEnvValue(env, 'NETWORK_MCP_UPSTREAM_TOKEN')), networkWorkerUrlConfigured: Boolean(env.NETWORK_MCP_WORKER_URL || env.CAREER_WORKER_URL)
  };
}

async function proxyAuth0(request: Request, env: Env, targetPath: string): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const issuer = getAuth0Issuer(env);
  if (!issuer) {
    return json(500, { ok: false, error: 'NETWORK_MCP_AUTH0_ISSUER is not configured' });
  }

  const targetUrl = new URL(`${issuer}${targetPath}`);
  targetUrl.search = incomingUrl.search;

  const headers = new Headers(request.headers);
  headers.delete('host');

  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    redirect: 'manual'
  });

  const passthroughHeaders = new Headers(response.headers);
  return new Response(response.body, {
    status: response.status,
    headers: passthroughHeaders
  });
}

async function authorizeMcpRequest(request: Request, env: Env): Promise<Response | null> {
  const configuredToken = env.NETWORK_MCP_TOKEN;
  if (!configuredToken) {
    return json(500, { ok: false, error: 'NETWORK_MCP_TOKEN is not configured' });
  }

  const auth = request.headers.get('authorization') || '';
  const presentedToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (!presentedToken) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  if (matchesAnyToken(presentedToken, [configuredToken, env.NETWORK_MCP_TOKEN_PREVIOUS])) {
    return null;
  }

  const issuer = getAuth0Issuer(env);
  if (!issuer) {
    return json(500, { ok: false, error: 'NETWORK_MCP_AUTH0_ISSUER is not configured' });
  }

  const allowedEmail = getAllowedEmail(env);
  if (!allowedEmail) {
    return json(500, { ok: false, error: 'NETWORK_MCP_ALLOWED_EMAIL is not configured' });
  }

  let userinfoResponse: Response;
  try {
    userinfoResponse = await fetch(`${issuer}/userinfo`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${presentedToken}`
      }
    });
  } catch {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  if (!userinfoResponse.ok) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  let userinfo: { email?: string };
  try {
    userinfo = (await userinfoResponse.json()) as { email?: string };
  } catch {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  if (userinfo.email !== allowedEmail) {
    return json(401, { ok: false, error: 'Unauthorized' });
  }

  return null;
}

function getMcpServerUrl(env: Env): string | null {
  return getRequiredEnvValue(env, 'NETWORK_MCP_SERVER_URL');
}

async function proxyMcpRequest(request: Request, env: Env): Promise<Response> {
  const upstreamUrl = getMcpServerUrl(env);
  if (!upstreamUrl) {
    return json(500, { ok: false, error: 'NETWORK_MCP_SERVER_URL is not configured' });
  }

  const target = new URL(upstreamUrl);
  const source = new URL(request.url);
  target.search = source.search;

  const headers = new Headers(request.headers);
  headers.delete('host');

  const upstreamToken = getRequiredEnvValue(env, 'NETWORK_MCP_UPSTREAM_TOKEN');
  if (upstreamToken) {
    headers.set('authorization', `Bearer ${upstreamToken}`);
  } else {
    headers.delete('authorization');
  }

  const response = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    redirect: 'manual'
  });

  return new Response(response.body, {
    status: response.status,
    headers: new Headers(response.headers)
  });
}

function matchesAnyToken(presentedToken: string, candidates: Array<string | undefined>): boolean {
  return candidates.some((candidate) => Boolean(candidate) && presentedToken === candidate);
}

async function callCareerWorkerTool(env: Env, route: string, payload: unknown): Promise<{ ok: boolean; body: string }> {
  const workerUrl = env.NETWORK_MCP_WORKER_URL || env.CAREER_WORKER_URL;
  if (!workerUrl) {
    return { ok: false, body: 'NETWORK_MCP_WORKER_URL is not configured' };
  }

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json'
    };
    if (env.NETWORK_MCP_BROWSER_WORKER_TOKEN) {
      headers.authorization = `Bearer ${env.NETWORK_MCP_BROWSER_WORKER_TOKEN}`;
    }

    const response = await fetch(`${workerUrl}${route}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload ?? {})
    });
    return { ok: response.ok, body: await response.text() };
  } catch {
    return { ok: false, body: 'Career worker proxy failed' };
  }
}

function jsonRpcResult(id: JsonRpcRequest['id'], result: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      result
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  );
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code,
        message,
        ...(data === undefined ? {} : { data })
      }
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }
  );
}

function isJsonRpcRequest(body: unknown): body is JsonRpcRequest {
  return Boolean(body && typeof body === 'object' && 'method' in body);
}

async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    return new Response('MCP streamable-http POST endpoint only', {
      status: 405,
      headers: { Allow: 'POST', 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, POST', 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  if (!isJsonRpcRequest(body) || typeof body.method !== 'string') {
    return jsonRpcError(null, -32600, 'Invalid Request');
  }

  const { id, method, params } = body;

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: true }
      },
      serverInfo: {
        name: 'network-mcp',
        version: '1.0.1'
      },
      instructions: 'Supervised career apply gateway.'
    });
  }

  if (id === undefined || id === null) {
    return new Response('', { status: 202 });
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, {
      tools: MCP_TOOLS.map(({ route, ...tool }) => tool)
    });
  }

  if (method === 'tools/call') {
    const toolName = typeof params?.name === 'string' ? params.name : '';
    const tool = MCP_TOOLS.find(item => item.name === toolName);
    if (!tool) {
      return jsonRpcError(id, -32602, 'Unknown tool');
    }

    const downstream = await callCareerWorkerTool(env, tool.route, params?.arguments ?? {});
    return jsonRpcResult(id, {
      content: [{ type: 'text', text: downstream.body }],
      ...(downstream.ok ? {} : { isError: true })
    });
  }

  if (method === 'ping') {
    return jsonRpcResult(id, {});
  }

  return jsonRpcError(id, -32601, 'Method not found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return json(200, { ok: true, service: 'network-mcp' });
    }

    if (url.pathname === '/.well-known/openid-configuration' || url.pathname === '/.well-known/oauth-authorization-server') {
      const oidcConfig = getPublicOidcConfig(env);
      if (!oidcConfig) {
        return json(500, { ok: false, error: 'NETWORK_MCP_AUTH0_ISSUER is not configured' });
      }

      return new Response(JSON.stringify(oidcConfig), {
        status: 200,
        headers: withJsonHeaders()
      });
    }

    if (url.pathname === '/authorize') {
      const issuer = getAuth0Issuer(env);
      const clientId = getOidcClientId(env);
      if (!issuer) {
        return json(500, { ok: false, error: 'NETWORK_MCP_AUTH0_ISSUER is not configured' });
      }
      if (!clientId) {
        return json(500, { ok: false, error: 'NETWORK_MCP_OIDC_CLIENT_ID is not configured' });
      }

      const authUrl = new URL(`${issuer}/authorize`);
      authUrl.search = url.search;
      if (!authUrl.searchParams.get('client_id')) {
        authUrl.searchParams.set('client_id', clientId);
      }

      return Response.redirect(authUrl.toString(), 302);
    }

    if (url.pathname === '/token') {
      return proxyAuth0(request, env, '/oauth/token');
    }

    if (url.pathname === '/userinfo') {
      return proxyAuth0(request, env, '/userinfo');
    }

    if (url.pathname === '/mcp') {
      const unauthorized = await authorizeMcpRequest(request, env);
      if (unauthorized) {
        return unauthorized;
      }

      return proxyMcpRequest(request, env);
    }

    if (url.pathname === '/mcp-debug') {
      return new Response(JSON.stringify(getMcpDebugInfo(env)), {
        status: 200,
        headers: withJsonHeaders()
      });
    }

    if (url.pathname === '/') {
      const configuredToken = env.NETWORK_MCP_TOKEN;
      if (!configuredToken) {
        return json(500, { ok: false, error: 'NETWORK_MCP_TOKEN is not configured' });
      }

      const auth = request.headers.get('authorization') || '';
      const presentedToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

      if (!presentedToken || !matchesAnyToken(presentedToken, [configuredToken, env.NETWORK_MCP_TOKEN_PREVIOUS])) {
        return json(401, { ok: false, error: 'Unauthorized' });
      }

      return json(200, { ok: true, service: 'network-mcp' });
    }

    return json(404, { ok: false, error: 'Not found' });
  }
};

