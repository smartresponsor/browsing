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
cd D:\PhpstormProjects\www\mcp\network-mcp
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

## Stable Cloudflare named tunnel

Use a named tunnel for the durable Network MCP path. Quick `trycloudflare.com` URLs are transition-only and should be removed after cutover.

Create the local config from `ops/cloudflare/cloudflared.named.example.yml`, keep the real credential JSON outside Git, then set:

```powershell
$env:NETWORK_MCP_TUNNEL_NAME = 'network-mcp-worker'
$env:NETWORK_MCP_TUNNEL_HOSTNAME = 'network.smartresponsor.com'
$env:NETWORK_MCP_TUNNEL_CONFIG = 'C:\Users\Admin\.cloudflared\network-mcp-worker.yml'
$env:NETWORK_MCP_WORKER_URL = 'https://network.smartresponsor.com'
```

Run the stable tunnel locally:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 start-named-tunnel
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 named-tunnel-status
```

Install the stable tunnel as a Windows service:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\tool\dev-network.ps1 install-named-tunnel-service
```

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
