[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$DevScript = Join-Path $PSScriptRoot 'dev-browser.ps1'
$WranglerConfig = Join-Path $Root 'cloudflare-worker\wrangler.jsonc'

if (-not (Test-Path -LiteralPath $DevScript)) {
    throw "dev-browser.ps1 not found: $DevScript"
}

if (-not (Test-Path -LiteralPath $WranglerConfig)) {
    throw "wrangler config not found: $WranglerConfig"
}

if (-not $env:BROWSER_MCP_MAX_SESSION_SECONDS) {
    $env:BROWSER_MCP_MAX_SESSION_SECONDS = '7200'
}

if (-not $env:BROWSER_MCP_MAX_PAGE_VISITS) {
    $env:BROWSER_MCP_MAX_PAGE_VISITS = '100'
}

if (-not $env:BROWSER_MCP_MAX_FORM_FILLS) {
    $env:BROWSER_MCP_MAX_FORM_FILLS = '20'
}

$restartText = & $DevScript restart
$restart = $restartText | ConvertFrom-Json

if (-not $restart.ok) {
    throw 'web restart failed.'
}

$publicUrl = [string]$restart.tunnel.public_url
if ([string]::IsNullOrWhiteSpace($publicUrl)) {
    throw 'web restart did not return tunnel.public_url.'
}

if ($publicUrl -notmatch '^https://[a-z0-9.-]+\.trycloudflare\.com$') {
    throw "unexpected tunnel URL: $publicUrl"
}

$content = Get-Content -LiteralPath $WranglerConfig -Raw
$updated = $content -replace '"BROWSER_MCP_WORKER_URL"\s*:\s*"[^"]+"', "`"BROWSER_MCP_WORKER_URL`": `"$publicUrl`""

if ($updated -eq $content -and $content -notmatch [regex]::Escape($publicUrl)) {
    throw 'BROWSER_MCP_WORKER_URL was not updated in wrangler.jsonc.'
}

Set-Content -LiteralPath $WranglerConfig -Value $updated -Encoding utf8

& $DevScript deploy-worker

[pscustomobject]@{
    ok = $true
    public_url = $publicUrl
    wrangler_config = $WranglerConfig
} | ConvertTo-Json -Depth 8

