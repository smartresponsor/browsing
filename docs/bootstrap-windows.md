# Bootstrap Windows

This is the bootstrap path for `network-mcp` on Windows.

## Prerequisites

- Node.js 20+ or current LTS
- PowerShell 7
- Git
- Cloudflare API access
- `cloudflared` if you want a local tunnel

## Install

```powershell
cd D:\PhpstormProjects\www\network-mcp
npm install
npm --prefix .\mcp-server install
npm --prefix .\playwright-worker install
npm --prefix .\playwright-worker run install:browsers
```

## Check the environment

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 doctor
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 status
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 check-cloudflared
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 check-wrangler
```

## Local env

Copy `ops/env/local.env.example` into a local shell profile or `.env` file outside Git.

The repo intentionally keeps real tokens out of version control.
If port `8791` is already in use in your workspace, set `NETWORK_MCP_WORKER_PORT` to a free port before starting the supervisor.

## Start

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 start
```

This starts the visible browser worker and the Cloudflare tunnel helper.

## Smoke

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 smoke-local
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 smoke-public
```

`smoke-public` requires `NETWORK_MCP_PUBLIC_ORIGIN` to be configured.

## Deploy

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 deploy-worker
```

Use the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` environment variables. Do not store them in Git.
