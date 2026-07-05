# Network MCP server runtime boundary

This repository currently keeps a small local MCP server so the Network MCP connector remains runnable before a shared neutral MCP runtime exists.

The local server is temporary infrastructure. The durable Network MCP value is the connector/tool surface and the supervised browser worker contract.

## Keep as Network MCP ownership

- `network.*` tool names and schemas.
- `NetworkToolRegistry` and its worker route mapping.
- Browser worker policy and safety controls.
- Playwright worker process, managed profile, visible browser behavior, and form-review approval gates.
- Network MCP deployment identifiers, public origins, connector URLs, tunnel names, token names, and OAuth/OIDC setting names.

## Treat as temporary server runtime

These concerns should eventually move to a shared neutral MCP runtime instead of being owned by Network MCP:

- HTTP server creation and listen lifecycle.
- MCP `StreamableHTTPServerTransport` creation.
- MCP request body parsing.
- MCP endpoint path dispatch.
- Bearer/OAuth validation primitives.
- Health endpoint convention.
- Request tracing and transcript storage.
- Process signal cleanup.
- Generic supervisor/watchdog/restart mechanics.

Until the neutral runtime exists, keep this local runtime thin and do not expand it with product behavior.

## Credential and deployment references to preserve

Do not rename or delete these references during cleanup. Values are secrets or environment-specific configuration and must stay outside Git unless already represented as examples.

### Public and connector origins

- `NETWORK_MCP_PUBLIC_ORIGIN`
- `NETWORK_MCP_SERVER_URL`
- `NETWORK_MCP_WORKER_URL`
- `NETWORK_MCP_BROWSER_WORKER_URL`
- `NETWORK_MCP_TUNNEL_NAME`
- `NETWORK_MCP_TUNNEL_HOSTNAME`
- `NETWORK_MCP_TUNNEL_CONFIG`

Known public examples currently documented:

- `https://network-mcp.taa0662621456.workers.dev`
- `https://network.smartresponsor.com`

### Local ports and endpoints

- `NETWORK_MCP_WORKER_PORT`, default `8791`
- `NETWORK_MCP_SERVER_PORT`, default `8792`
- `NETWORK_MCP_SERVER_HOST`, default `127.0.0.1`
- `NETWORK_MCP_SERVER_ENDPOINT`, default `/mcp`
- `NETWORK_MCP_REMOTE_DEBUGGING_PORT`, default `9223` when visible external browser mode is requested

### Token and secret names

- `NETWORK_MCP_TOKEN`
- `NETWORK_MCP_TOKEN_PREVIOUS`
- `NETWORK_MCP_UPSTREAM_TOKEN`
- `NETWORK_MCP_UPSTREAM_TOKEN_PREVIOUS`
- `NETWORK_MCP_BROWSER_WORKER_TOKEN`
- `NETWORK_MCP_BROWSER_WORKER_TOKEN_PREVIOUS`

### OAuth/OIDC references

- `NETWORK_MCP_AUTH0_ISSUER`
- `NETWORK_MCP_OIDC_CLIENT_ID`
- `NETWORK_MCP_ALLOWED_EMAIL`
- `NETWORK_MCP_OAUTH_ISSUER`
- `NETWORK_MCP_OAUTH_AUDIENCE`
- `NETWORK_MCP_OAUTH_REQUIRED_SCOPE`
- `NETWORK_MCP_OAUTH_CLIENT_ID`

Known Auth0 issuer examples currently documented:

- `https://dev-zdyugcgamq4bca8f.us.auth0.com`
- `https://dev-zdyugcgamq4bca8f.us.auth0.com/`
