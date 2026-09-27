# network-mcp

`network-mcp` is a ChatGPT-driven, supervised opportunity-assistance MVP for Windows.

It combines:

- a thin Cloudflare Worker gateway
- a local visible Playwright browser worker
- a small MCP tool registry skeleton
- explicit approval before fill actions
- submit disabled by default

## MVP flow

1. User provides one URL in ChatGPT.
2. The browser worker opens it visibly.
3. The worker discovers likely opportunity links within a limited scope.
4. ChatGPT presents options.
5. The user selects a page or form.
6. The worker opens it visibly and inspects fields.
7. ChatGPT proposes values.
8. The user approves.
9. The worker fills approved fields only.
10. Submit stays manual unless an explicit submit mode is enabled later.

Final submit is intentionally not auto-implemented in the MVP.

## Policy defaults

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
NETWORK_MCP_BROWSER_CHANNEL=msedge
NETWORK_MCP_EXTERNAL_VISIBLE_BROWSER=true
NETWORK_MCP_EXTERNAL_VISIBLE_CHROME=true
```

## Tool contract

Documented safe operations:

- `network.open`
- `network.inspect`
- `network.extract_form`
- `network.propose`
- `network.fill_after_approval`
- `network.review_before_submit`

## Safety defaults

- Browser is visible by default.
- Login and registration are user-driven.
- CAPTCHA, 2FA, and security challenge pages pause automation.
- Credentials are entered manually by the user.
- Form values are not logged by default.
- Browser storage, cookies, screenshots, traces, videos, and downloads stay in ignored runtime directories such as `var\browser\`.
- One active browser session is the default operating model.

## Local commands

```powershell
cd D:\PhpstormProjects\www\mcp\network-mcp
npm install
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 doctor
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 start
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 smoke-local
```

## Documentation

- [MVP assisted application](docs/mvp-assisted-application.md)
- [Operations](docs/operations.md)
- [Security](docs/security.md)
- [Restore on Windows](docs/restore-windows.md)
- [ChatGPT session availability](docs/chatgpt-session-availability.md)

## Cloudflare

- Worker config: `cloudflare-worker/wrangler.jsonc`
- Public health check: `/healthz` returns `service: "network-mcp"`
- Worker deploy remains a manual action through the supervisor or `wrangler`
