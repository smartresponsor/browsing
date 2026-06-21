# Cloudflare Operations

This repo uses Cloudflare in two ways:

- a deployed Worker in `cloudflare-worker/`
- a local `cloudflared` tunnel for the visible browser worker

## Worker deploy

Prerequisites:

- `npm install` at the repo root so `node_modules/.bin/wrangler` exists
- `CLOUDFLARE_API_TOKEN` in the environment
- `CLOUDFLARE_ACCOUNT_ID` in the environment

If you prefer interactive auth while developing, run `wrangler login` once and verify the active identity with `wrangler whoami`.
When multiple Cloudflare accounts are available, make sure `CLOUDFLARE_ACCOUNT_ID` targets the account you intend to deploy into.

Resolve and deploy through the supervisor:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 check-wrangler
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 deploy-worker
```

Do not commit secrets or Cloudflare credentials.

If you need to add secrets to the Worker, use Cloudflare secret handling, not Git.
`NETWORK_MCP_TOKEN` and `NETWORK_MCP_BROWSER_WORKER_TOKEN` must be configured as secrets or environment bindings, not committed.
`NETWORK_MCP_AUTH0_ISSUER`, `NETWORK_MCP_OIDC_CLIENT_ID`, and `NETWORK_MCP_ALLOWED_EMAIL` are deployment configuration and should be set per environment.

## Tunnel support

For a local browser worker tunnel, `cloudflared.exe` is resolved in this order:

1. `NETWORK_MCP_CLOUDFLARED_BIN`
2. `C:\Tools\cloudflared\cloudflared.exe`
3. `cloudflared.exe` on `PATH`
4. fail closed

Do not rely on `%TEMP%\cloudflared.exe`.

If you switch to a named tunnel, keep the YAML template in Git and keep the credential JSON outside Git.
If the browser worker is exposed through the tunnel, set `NETWORK_MCP_BROWSER_WORKER_TOKEN` and forward it from the caller.

See `ops/cloudflare/cloudflared.example.yml` for the template shape.
