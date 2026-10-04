# Restore on Windows

This is the minimal restore path for `browser-mcp`.

## 1. Install prerequisites

- Node.js 20+ or current LTS
- PowerShell 7
- Git
- `cloudflared` if you need a local tunnel

## 2. Clone the repo

```powershell
git clone <repo-url> D:\PhpstormProjects\www\mcp\Browsing
cd D:\PhpstormProjects\www\mcp\Browsing
```

## 3. Install dependencies

```powershell
npm install
npm --prefix .\mcp-server install
npm --prefix .\playwright-worker install
npm --prefix .\playwright-worker run install:browsers
```

## 4. Prepare local env

Use `ops/env/local.env.example` as the reference for shell variables.

Keep actual secrets out of Git.
If `8791` is occupied, set `BROWSER_MCP_WORKER_PORT` to a free local port.

## 5. Run the supervisor

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-browser.ps1 doctor
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-browser.ps1 start
```

## 6. Smoke test

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-browser.ps1 smoke-local
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-browser.ps1 smoke-public
```

`smoke-public` requires `BROWSER_MCP_PUBLIC_ORIGIN`.

## 7. Deploy the worker

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-browser.ps1 deploy-worker
```

Use the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment variables.
