# Operations

`tool/dev-network.ps1` is the Windows supervisor for this repo.

## MVP policy defaults

The assisted-application MVP uses these safe defaults:

```env
NETWORK_MCP_MODE=local-assist
NETWORK_MCP_HEADLESS=false
NETWORK_MCP_REQUIRE_APPROVAL_FOR_FILL=true
NETWORK_MCP_REQUIRE_APPROVAL_FOR_SUBMIT=true
NETWORK_MCP_SUBMIT_DEFAULT=false
NETWORK_MCP_ENABLE_SUBMIT=false
NETWORK_MCP_MAX_SESSION_SECONDS=900
NETWORK_MCP_MAX_PAGE_VISITS=20
NETWORK_MCP_MAX_FORM_FILLS=1
NETWORK_MCP_MAX_FIELD_WRITES=80
NETWORK_MCP_ALLOWED_HOSTS=
NETWORK_MCP_DENIED_HOSTS=
NETWORK_MCP_PUBLIC_ORIGIN=
NETWORK_MCP_WORKER_PORT=8791
NETWORK_MCP_BROWSER_WORKER_TOKEN=
NETWORK_MCP_AUTH0_ISSUER=https://example.auth0.com
NETWORK_MCP_OIDC_CLIENT_ID=replace-with-auth0-client-id
NETWORK_MCP_ALLOWED_EMAIL=user@example.com
```

The browser stays visible by default. Login, registration, CAPTCHA, 2FA, and security challenge pages are user-driven pauses, not automation targets.

## Commands

- `doctor`
- `doctor-json`
- `status`
- `start`
- `stop`
- `restart`
- `start-mcp`
- `stop-mcp`
- `restart-mcp`
- `smoke-local`
- `smoke-public`
- `smoke-mcp`
- `check-cloudflared`
- `check-wrangler`
- `tail-server-log`
- `tail-tunnel-log`
- `start-named-tunnel`
- `stop-named-tunnel`
- `named-tunnel-status`
- `install-named-tunnel-service`
- `install-startup-task`
- `uninstall-startup-task`
- `show-startup-task`

## What each command does

- `doctor` summarizes prerequisites, worker state, tunnel state, and smoke readiness.
- `status` returns JSON describing the local worker, MCP server, tunnel, and smoke checks.
- `start` starts the browser worker, MCP server, and tunnel helper.
- `stop` stops all managed local processes.
- `restart` restarts all managed local processes.
- `start-mcp` starts only the local MCP server.
- `stop-mcp` stops only the local MCP server.
- `restart-mcp` restarts only the local MCP server.
- `smoke-local` exercises the browser worker against a public sample form.
- `smoke-public` checks `GET /healthz` on `NETWORK_MCP_PUBLIC_ORIGIN`.
- `smoke-mcp` verifies local MCP initialize and tools/list responses.
- `check-cloudflared` resolves `cloudflared` without using `%TEMP%`.
- `check-wrangler` resolves the local `wrangler` binary and reports Cloudflare env presence.
- `deploy-worker` remains a manual command. It is not chained into doctor, status, start, restart, or startup tasks.
- `start-named-tunnel` starts the stable named Cloudflare tunnel for the local visible browser worker.
- `stop-named-tunnel` stops the named tunnel process started by this supervisor.
- `named-tunnel-status` reports the named tunnel process, config path, and hostname.
- `install-named-tunnel-service` installs `cloudflared` as a Windows service using the named tunnel config.

## Local pre-commit hook

The optional local Git hook at `C:\Users\Admin\.githooks\pre-commit` runs `vendor/bin/php-cs-fixer` only when staged PHP files exist and the binary is present.
If staged PHP files exist but the fixer is missing, the hook prints a warning and lets the commit continue.
Real php-cs-fixer failures still block the commit when the tool exists.

## Runtime guardrails

- Reject or pause on denied hosts.
- Allow only one active browser session by default.
- Enforce max session seconds.
- Enforce max page visits.
- Enforce max form fills.
- Enforce max field writes.
- Require approval for fill actions.
- Require separate approval for submit actions.
- Disable submit unless `NETWORK_MCP_ENABLE_SUBMIT=true`.

## Cloudflare worker notes

- `wrangler` must be available locally through `node_modules/.bin/wrangler`, PATH, or an installed package script.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` stay in the environment, not in Git.
- `CAREER_WORKER_URL` should point to the public tunnel URL for the local browser worker.
- The browser worker must remain local-only or be protected with `NETWORK_MCP_BROWSER_WORKER_TOKEN`.
- If the browser worker is exposed through Cloudflare Tunnel, token protection is required.
- `NETWORK_MCP_TOKEN` and `NETWORK_MCP_BROWSER_WORKER_TOKEN` must be configured as secrets or environment bindings, not committed.
- `NETWORK_MCP_AUTH0_ISSUER`, `NETWORK_MCP_OIDC_CLIENT_ID`, and `NETWORK_MCP_ALLOWED_EMAIL` are deployment configuration and should be set per environment.
- Secrets and credentials are managed through Cloudflare or the shell, never committed.
- The Cloudflare Worker remains a thin gateway: auth, routing, status/smoke, small request validation, and rate/limit guard only.
- It must not crawl, run long browser jobs, call AI, mass-retry, or store heavy workflow state for the MVP.

## Tunnel notes

The target production path is a Cloudflare named tunnel. Quick `trycloudflare.com` URLs are transitional only and must not be treated as stable application configuration.

Named tunnel local configuration:

```env
NETWORK_MCP_TUNNEL_NAME=network-mcp-worker
NETWORK_MCP_TUNNEL_HOSTNAME=network.smartresponsor.com
NETWORK_MCP_TUNNEL_CONFIG=C:\Users\Admin\.cloudflared\network-mcp-worker.yml
NETWORK_MCP_WORKER_URL=https://network.smartresponsor.com
```

Use `ops/cloudflare/cloudflared.named.example.yml` as the template. Keep the real credential JSON outside Git.

Stable local run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 start-named-tunnel
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 named-tunnel-status
```

Stable Windows service install:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 install-named-tunnel-service
```

- `cloudflared.exe` resolves in this order:
  - `NETWORK_MCP_CLOUDFLARED_BIN`
  - `C:\Tools\cloudflared\cloudflared.exe`
  - `cloudflared.exe` on `PATH`
  - fail closed
- Do not use `%TEMP%\cloudflared.exe`.
- Keep any named-tunnel credentials outside Git.

After the stable named tunnel is cut over, remove quick-tunnel startup from the supervisor instead of keeping it as a permanent fallback.

## Logs

- `var\log\playwright-worker.log`
- `var\log\playwright-worker.err.log`
- `var\log\cloudflared.log`
- `var\log\cloudflared.err.log`
- Browser artifacts such as screenshots, traces, videos, and downloads stay under ignored runtime directories like `var\browser\`.

## Startup task

The startup task is user-level and starts the supervisor at logon.

Use `install-startup-task` and `uninstall-startup-task` to manage it.
