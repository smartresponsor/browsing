# Cloudflare Tunnel For Career Worker

Use this when the Cloudflare Worker needs to reach the local `playwright-worker` through a public Cloudflare Tunnel URL.

## Local worker port

The local browser worker listens on port `8791` by default.

Source of truth:

- `playwright-worker/src/worker.js`

## Start the tunnel

Run:

```powershell
cd D:\PhpstormProjects\www\mcp\network-mcp
.\script\start-career-tunnel.ps1
```

The script will:

- start `playwright-worker` if it is not already listening
- start a Cloudflare Tunnel to `http://127.0.0.1:8791`
- print the public `https://*.trycloudflare.com` URL

## Where to paste the URL

Paste the printed public tunnel URL into the `CAREER_WORKER_URL` value used by the Cloudflare Worker.

Recommended command:

```powershell
echo https://your-public-tunnel.trycloudflare.com | wrangler secret put CAREER_WORKER_URL --config D:\PhpstormProjects\www\mcp\network-mcp\cloudflare-worker\wrangler.jsonc
```

If you prefer an environment variable for a local-only session, set `CAREER_WORKER_URL` in your shell before `wrangler deploy` or `wrangler dev`.

## Notes

- Do not change OAuth/Auth0 settings for this wiring.
- Do not change MCP tool names.
- Keep submit/fill approval-gated in the browser worker and MCP layer.
- If you expose the browser worker through Cloudflare Tunnel, set `NETWORK_MCP_BROWSER_WORKER_TOKEN` and forward it from the gateway or local caller.
- `cloudflared` must be installed and available in `PATH`.

## Troubleshooting

- If the script says the worker did not start, check `storage\tunnel\playwright-worker.out.log` and `storage\tunnel\playwright-worker.err.log`.
- If `NETWORK_MCP_WORKER_PORT` is set, the tunnel script uses that port instead of the default `8791`.
- If the script cannot find `cloudflared`, install Cloudflare Tunnel first and re-run the script.
- If the tunnel URL is not detected, check `storage\tunnel\cloudflared.out.log` and `storage\tunnel\cloudflared.err.log`.
