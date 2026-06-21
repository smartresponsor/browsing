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
- `smoke-local`
- `smoke-public`
- `check-cloudflared`
- `check-wrangler`
- `tail-server-log`
- `tail-tunnel-log`
- `install-startup-task`
- `uninstall-startup-task`
- `show-startup-task`

## What each command does

- `doctor` summarizes prerequisites, worker state, tunnel state, and smoke readiness.
- `status` returns JSON describing the local worker and tunnel.
- `start` starts the browser worker and tunnel helper.
- `stop` stops both managed processes.
- `restart` restarts both managed processes.
- `smoke-local` exercises the browser worker against a public sample form.
- `smoke-public` checks `GET /healthz` on `NETWORK_MCP_PUBLIC_ORIGIN`.
- `check-cloudflared` resolves `cloudflared` without using `%TEMP%`.
- `check-wrangler` resolves the local `wrangler` binary and reports Cloudflare env presence.
- `deploy-worker` remains a manual command. It is not chained into doctor, status, start, restart, or startup tasks.

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

- `cloudflared.exe` resolves in this order:
  - `NETWORK_MCP_CLOUDFLARED_BIN`
  - `C:\Tools\cloudflared\cloudflared.exe`
  - `cloudflared.exe` on `PATH`
  - fail closed
- Do not use `%TEMP%\cloudflared.exe`.
- Keep any named-tunnel credentials outside Git.

## Logs

- `var\log\playwright-worker.log`
- `var\log\playwright-worker.err.log`
- `var\log\cloudflared.log`
- `var\log\cloudflared.err.log`
- Browser artifacts such as screenshots, traces, videos, and downloads stay under ignored runtime directories like `var\browser\`.

## Startup task

The startup task is user-level and starts the supervisor at logon.

Use `install-startup-task` and `uninstall-startup-task` to manage it.
