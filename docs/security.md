# Security

This repo is supervised and approval-gated.

## Browser safety policy

- Browser is visible by default on Windows.
- Browser worker must remain local-only or be protected with `BROWSER_MCP_BROWSER_WORKER_TOKEN`.
- If the browser worker is exposed through Cloudflare Tunnel, token protection is required.
- Login and registration must be user-driven.
- CAPTCHA, 2FA, and security challenge pages pause automation.
- Credentials are entered manually by the user.
- Form values are not logged by default.
- Browser storage state and cookies are not committed.
- Screenshots, traces, videos, and downloads stay in ignored runtime directories such as `var\browser\`.

## MVP defaults

```env
BROWSER_MCP_MODE=local-assist
BROWSER_MCP_HEADLESS=false
BROWSER_MCP_REQUIRE_APPROVAL_FOR_FILL=true
BROWSER_MCP_REQUIRE_APPROVAL_FOR_SUBMIT=true
BROWSER_MCP_SUBMIT_DEFAULT=false
BROWSER_MCP_ENABLE_SUBMIT=false
BROWSER_MCP_MAX_SESSION_SECONDS=900
BROWSER_MCP_MAX_PAGE_VISITS=20
BROWSER_MCP_MAX_FORM_FILLS=1
BROWSER_MCP_MAX_FIELD_WRITES=80
BROWSER_MCP_BROWSER_WORKER_TOKEN=
BROWSER_MCP_AUTH0_ISSUER=https://example.auth0.com
BROWSER_MCP_OIDC_CLIENT_ID=replace-with-auth0-client-id
BROWSER_MCP_ALLOWED_EMAIL=user@example.com
```

## Never commit

- bearer tokens
- OAuth access tokens
- client secrets
- authorization codes
- refresh tokens
- raw `Authorization` headers
- Cloudflare API tokens
- Cloudflare account IDs when they are environment-bound
- tunnel credential JSON
- local runtime logs
- browser session state
- browser storage files
- downloaded application artifacts
- screenshots, traces, videos, and HAR files

## Safe storage

- Keep shell secrets in the environment or a local secret store.
- Keep Cloudflare secrets in Cloudflare, not in Git.
- Keep `cloudflared` credential files outside the repository.
- Keep `.env` files local-only.
- `BROWSER_MCP_TOKEN` and `BROWSER_MCP_BROWSER_WORKER_TOKEN` must be configured as secrets or environment bindings, not committed.
- `BROWSER_MCP_AUTH0_ISSUER`, `BROWSER_MCP_OIDC_CLIENT_ID`, and `BROWSER_MCP_ALLOWED_EMAIL` are deployment configuration and should be set per environment.

## Logging

- Prefer sanitized status output over raw request dumps.
- Do not print secrets in smoke or doctor commands.
- Do not log approval tokens or form content beyond what is needed for a local smoke check.
- Do not log captured field values by default.

## Browser policy

- Fill actions stay behind explicit approval.
- Submit is disabled by default and stays off unless explicitly enabled later.
- Final submit is not auto-implemented in the MVP.
