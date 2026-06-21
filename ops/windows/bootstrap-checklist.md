# Bootstrap Checklist

Use this when preparing `network-mcp` on a new Windows machine.

## Prerequisites

- Node.js 20+ or current LTS
- PowerShell 7
- Git
- `cloudflared` if you need a local tunnel

## Steps

1. Clone the repo.
2. Run `npm install`.
3. Run `npm --prefix .\mcp-server install`.
4. Run `npm --prefix .\playwright-worker install`.
5. Run `npm --prefix .\playwright-worker run install:browsers`.
6. Run `pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 doctor`.
7. Run `pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 status`.
8. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment.
9. Run `pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 deploy-worker`.
10. Run `pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 smoke-local`.
11. Set `NETWORK_MCP_PUBLIC_ORIGIN` and run `pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 smoke-public`.
12. If port `8791` is busy, set `NETWORK_MCP_WORKER_PORT` to a free port first.

## Notes

- Do not commit `.env` files or Cloudflare credentials.
- Keep the browser worker visible on Windows by leaving Playwright headless mode off.
- If you install the logon task, use `install-startup-task`.
