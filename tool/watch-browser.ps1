[CmdletBinding()]
param(
    [int]$IntervalSeconds = 15,
    [switch]$Once
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$DevWeb = Join-Path $PSScriptRoot 'dev-browser.ps1'
$LogDir = Join-Path $Root 'var\log'
$RunDir = Join-Path $Root 'var\run'
$WatchdogLoopLogFile = Join-Path $LogDir 'web-watchdog-loop.ndjson'
$WatchdogLoopStateFile = Join-Path $RunDir 'web-watchdog-loop-state.json'

function Ensure-WatchdogDirectories {
    foreach ($path in @($LogDir, $RunDir)) {
        New-Item -ItemType Directory -Force -Path $path | Out-Null
    }
}

function Write-WatchdogLoopEvent {
    param([Parameter(Mandatory = $true)][object]$Event)

    Ensure-WatchdogDirectories
    ($Event | ConvertTo-Json -Depth 12 -Compress) | Add-Content -LiteralPath $WatchdogLoopLogFile -Encoding utf8
    $Event | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $WatchdogLoopStateFile -Encoding utf8
}

function Invoke-WatchdogTick {
    $startedAt = Get-Date
    try {
        $raw = & pwsh -NoProfile -ExecutionPolicy Bypass -File $DevWeb watch-tick
        $parsed = $null
        try {
            $parsed = $raw | ConvertFrom-Json
        } catch {
            $parsed = $raw
        }

        $event = [pscustomobject]@{
            ts = $startedAt.ToUniversalTime().ToString('o')
            ok = $true
            command = 'watch-tick'
            elapsed_ms = [int]((Get-Date) - $startedAt).TotalMilliseconds
            result = $parsed
        }
        Write-WatchdogLoopEvent -Event $event
        return $event
    } catch {
        $event = [pscustomobject]@{
            ts = $startedAt.ToUniversalTime().ToString('o')
            ok = $false
            command = 'watch-tick'
            elapsed_ms = [int]((Get-Date) - $startedAt).TotalMilliseconds
            error = if ($_.Exception) { $_.Exception.Message } else { [string]$_ }
        }
        Write-WatchdogLoopEvent -Event $event
        return $event
    }
}

do {
    Invoke-WatchdogTick | ConvertTo-Json -Depth 12
    if ($Once) {
        break
    }
