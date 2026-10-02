[CmdletBinding()]
param(
    [ValidateSet('status', 'start', 'stop', 'restart')]
    [string]$Command = 'status',
    [int]$Port = 9223
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$SharedRoot = if ($env:BROWSER_MCP_SHARED_BROWSER_ROOT) { $env:BROWSER_MCP_SHARED_BROWSER_ROOT } else { Join-Path (Split-Path -Parent $Root) 'browser' }
$Profile = if ($env:BROWSER_MCP_USER_DATA_DIR) { $env:BROWSER_MCP_USER_DATA_DIR } else { Join-Path $SharedRoot 'profile' }
$RunDir = Join-Path $SharedRoot 'run'
$LogDir = Join-Path $SharedRoot 'log'
$RuntimeFile = Join-Path $RunDir 'browser-runtime.json'
$LogFile = Join-Path $LogDir 'shared-browser.log'

function Ensure-SharedBrowserDirectory {
    New-Item -ItemType Directory -Force -Path $SharedRoot | Out-Null
    New-Item -ItemType Directory -Force -Path $Profile | Out-Null
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

function Resolve-BrowserExecutable {
    if ($env:BROWSER_MCP_BROWSER_EXECUTABLE -and (Test-Path -LiteralPath $env:BROWSER_MCP_BROWSER_EXECUTABLE)) {
        return $env:BROWSER_MCP_BROWSER_EXECUTABLE
    }

    $candidates = @(
        'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
        'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        'C:\Program Files\Google\Chrome\Application\chrome.exe',
        'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw 'No supported browser executable was found.'
}

function Invoke-CdpVersion {
    param([int]$DebugPort)
    try {
        return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$DebugPort/json/version" -TimeoutSec 3
    } catch {
        return $null
    }
}

function Get-SharedBrowserProcess {
    $fullProfile = [System.IO.Path]::GetFullPath($Profile).TrimEnd('\')
    $names = @('msedge.exe', 'chrome.exe', 'chromium.exe')
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $names -contains $_.Name -and $_.CommandLine -and (
                $_.CommandLine -like ('*--remote-debugging-port=' + $Port + '*') -or
                $_.CommandLine -like ('*--user-data-dir=' + $fullProfile + '*') -or
                $_.CommandLine -like ('*' + $fullProfile + '*')
            )
        })
}

function Stop-SharedBrowser {
    $processes = @(Get-SharedBrowserProcess)
    foreach ($item in $processes) {
        try {
            Stop-Process -Id ([int]$item.ProcessId) -Force -ErrorAction Stop
        } catch {
            Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value ("[{0}] stop failed pid={1}: {2}" -f (Get-Date).ToString('o'), $item.ProcessId, $_.Exception.Message)
        }
    }
    Start-Sleep -Milliseconds 500
    return $processes.Count
}

function Start-SharedBrowser {
    $version = Invoke-CdpVersion -DebugPort $Port
    if ($version) {
        return $true
    }

    $executable = Resolve-BrowserExecutable
    $arguments = @(
        "--remote-debugging-port=$Port",
        "--user-data-dir=$Profile",
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-mode',
        '--new-window',
        '--start-maximized',
        '--window-position=80,80',
        '--window-size=1400,1000',
        'https://chatgpt.com/'
    )

    Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Maximized | Out-Null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Invoke-CdpVersion -DebugPort $Port) {
            return $true
        }
    }

    return $false
}

function Save-SharedBrowserRegistry {
    param([string]$State)
    $version = Invoke-CdpVersion -DebugPort $Port
    $processes = @(Get-SharedBrowserProcess)
    $userAgent = if ($version -and $version.'User-Agent') { [string]$version.'User-Agent' } else { '' }
    $product = if ($userAgent -match 'Edg/') { 'msedge' } elseif ($userAgent -match 'Chrome/') { 'chrome' } else { '' }
    $registry = [pscustomobject]@{
        ok = [bool]($version)
        state = if ($version) { $State } else { 'DOWN' }
        owner = 'shared-browser-owner'
        preferred_product = 'msedge'
        fallback_product = 'chrome'
        actual_product = $product
        actual_user_agent = $userAgent
        cdp_endpoint = "http://127.0.0.1:$Port"
        root = $SharedRoot
        profile = $Profile
        process_count = $processes.Count
        visible_window_detected = $false
        updated_at = (Get-Date).ToUniversalTime().ToString('o')
    }
    $registry | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $RuntimeFile -Encoding UTF8
    return $registry
}

Ensure-SharedBrowserDirectory

if ($Command -eq 'stop') {
    Stop-SharedBrowser | Out-Null
    Save-SharedBrowserRegistry -State 'STOPPED' | ConvertTo-Json -Depth 8
    exit 0
}

if ($Command -eq 'restart') {
    Stop-SharedBrowser | Out-Null
    $started = Start-SharedBrowser
    Save-SharedBrowserRegistry -State $(if ($started) { 'STARTED' } else { 'FAILED' }) | ConvertTo-Json -Depth 8
    exit $(if ($started) { 0 } else { 1 })
}

if ($Command -eq 'start') {
    $started = Start-SharedBrowser
    $state = if ($started) { 'STARTED' } else { 'FAILED' }
    Save-SharedBrowserRegistry -State $state | ConvertTo-Json -Depth 8
    if ($started) { exit 0 }
    exit 1
}

Save-SharedBrowserRegistry -State 'ATTACHED' | ConvertTo-Json -Depth 8
