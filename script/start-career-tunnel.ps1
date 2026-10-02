$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $repoRoot "playwright-worker"
$workerSource = Join-Path $workerRoot "src\worker.js"
$workerLogDir = Join-Path $repoRoot "storage\tunnel"
$workerStdout = Join-Path $workerLogDir "playwright-worker.out.log"
$workerStderr = Join-Path $workerLogDir "playwright-worker.err.log"
$tunnelStdout = Join-Path $workerLogDir "cloudflared.out.log"
$tunnelStderr = Join-Path $workerLogDir "cloudflared.err.log"

function Get-PlaywrightWorkerPort {
  param(
    [string]$SourcePath
  )

  if ($env:BROWSER_MCP_WORKER_PORT) {
    return [int]$env:BROWSER_MCP_WORKER_PORT
  }

  $source = Get-Content -LiteralPath $SourcePath -Raw
  if ($source -match 'process\.env\.PORT\s*\|\|\s*(\d+)') {
    return [int]$Matches[1]
  }

  return 8791
}

function Test-TcpListener {
  param(
    [int]$Port
  )

  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-ForTcpListener {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 45
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-TcpListener -Port $Port) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Ensure-PlaywrightWorker {
  param(
    [int]$Port
  )

  if (Test-TcpListener -Port $Port) {
    Write-Host "playwright-worker already listening on port $Port"
    return
  }

  New-Item -ItemType Directory -Force -Path $workerLogDir | Out-Null
  $env:PORT = "$Port"
  Start-Process -FilePath "npm.cmd" -ArgumentList @("--prefix", ".\playwright-worker", "run", "start") -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $workerStdout -RedirectStandardError $workerStderr -PassThru | Out-Null

  if (-not (Wait-ForTcpListener -Port $Port)) {
    throw "playwright-worker did not start on port $Port"
  }

  Write-Host "playwright-worker started on port $Port"
}

function Get-CloudflaredPath {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  throw "cloudflared was not found in PATH. Install Cloudflare Tunnel first."
}

function Start-CloudflaredTunnel {
  param(
    [int]$Port
  )

  New-Item -ItemType Directory -Force -Path $workerLogDir | Out-Null
  $cloudflared = Get-CloudflaredPath
  foreach ($path in @($tunnelStdout, $tunnelStderr)) {
    if (Test-Path $path) {
      Remove-Item -Force $path
    }
  }

  Start-Process -FilePath $cloudflared -ArgumentList @(
    "tunnel",
    "--url",
    "http://127.0.0.1:$Port",
    "--no-autoupdate",
    "--loglevel",
    "info"
  ) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $tunnelStdout -RedirectStandardError $tunnelStderr -PassThru | Out-Null

  $deadline = (Get-Date).AddSeconds(60)
  $publicUrl = $null
  while ((Get-Date) -lt $deadline -and -not $publicUrl) {
    $logText = ''
    foreach ($path in @($tunnelStdout, $tunnelStderr)) {
      if (Test-Path $path) {
        $logText += "`n" + (Get-Content -LiteralPath $path -Raw)
      }
    }
    if ($logText) {
      if ($logText -match 'https://[a-z0-9.-]+\.trycloudflare\.com') {
        $publicUrl = $Matches[0]
        break
      }
    }
    Start-Sleep -Milliseconds 500
  }

  if (-not $publicUrl) {
    throw "Could not detect the public tunnel URL from cloudflared logs."
  }

  return $publicUrl
}

$port = Get-PlaywrightWorkerPort -SourcePath $workerSource
Ensure-PlaywrightWorker -Port $port
$publicUrl = Start-CloudflaredTunnel -Port $port

Write-Host ""
Write-Host "Playwright worker port: $port"
Write-Host "Public tunnel URL: $publicUrl"
Write-Host "Paste this URL into CAREER_WORKER_URL in Cloudflare Worker config."
