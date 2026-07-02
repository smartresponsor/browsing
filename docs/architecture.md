# Architecture

`network-mcp` is a hybrid career-apply stack:

- a Cloudflare Worker gateway in `cloudflare-worker/src/index.ts`
- a local visible Playwright browser worker in `playwright-worker/src/worker.js`
- a local MCP server in `mcp-server/src/server.js`

The product logic is intentionally supervised. The browser worker exposes only the safe career flow:

1. open
2. inspect
3. extract form
4. propose
5. fill after approval
6. review before submit

Final submit is not auto-implemented.

## Current entrypoints

- `cloudflare-worker/src/index.ts` - public health, OIDC metadata, MCP gateway, and worker proxying.
- `playwright-worker/src/worker.js` - local browser automation worker on port `8791`.
- `mcp-server/src/server.js` - local MCP endpoint on port `8792`.

## Architectural guardrails

- Keep the Cloudflare Worker as a public gateway and proxy. It must not own browser automation, persistent browser profiles, cookies, form-fill logic, or the MCP tool schema.
- Keep the local MCP server as the schema owner for MCP tools. Cloudflare may proxy `/mcp`, but it must not fork or duplicate the tool registry.
- Keep the browser worker local and supervised. It owns visible browser control, profile locking recovery, click/open/inspect/extract/fill endpoints, and challenge-page pauses.
- Keep startup passive. The default startup page is the local worker health endpoint, `http://127.0.0.1:8791/healthz`; startup must not click, fill, submit, or navigate to third-party sites unless an operator explicitly sets `NETWORK_MCP_START_URL`.
- Keep destructive actions out of automation. Final submit remains disabled by default and cannot be added without an explicit policy and documentation change.
- Keep profile cleanup scoped to managed processes for the configured `NETWORK_MCP_USER_DATA_DIR`; do not terminate unrelated user browser sessions.

## Local ports

- `playwright-worker` listens on `127.0.0.1:8791` by default.
- `mcp-server` listens on `127.0.0.1:8792/mcp` by default.
- The durable public browser-worker path should use a Cloudflare named tunnel hostname; quick `cloudflared tunnel --url ...` tunnels are transition-only.

## Auth model

- `cloudflare-worker` accepts a bearer token through `NETWORK_MCP_TOKEN`.
- The worker also proxies Auth0/OIDC metadata and userinfo for the public ChatGPT-style path.
- The browser worker must remain local-only or be protected with `NETWORK_MCP_BROWSER_WORKER_TOKEN`.
- If the browser worker is exposed through Cloudflare Tunnel, token protection is required.

## Cloudflare usage

- Deployment is through `cloudflare-worker/wrangler.jsonc`.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are expected from the environment.
- `CAREER_WORKER_URL` points the Cloudflare Worker at the public tunnel for the local browser worker.

## Operational notes

- The browser launches with `headless: false`, so Playwright stays visible on Windows by default.
- The default browser mode is Playwright-managed bundled Chromium. Set `NETWORK_MCP_BROWSER_CHANNEL=chrome` or `NETWORK_MCP_BROWSER_CHANNEL=msedge` to use installed Chrome or Edge through Playwright.
- The shared external browser/CDP launcher is controlled through `NETWORK_MCP_EXTERNAL_VISIBLE_BROWSER=true`; `NETWORK_MCP_EXTERNAL_VISIBLE_CHROME` remains a legacy alias.
- Local smoke checks use a data URL form to avoid depending on external sites.
- Health and smoke commands are operational checks, not product features.
