function Ensure-SharedBrowserEnvironment {
    if (-not $env:BROWSER_MCP_SHARED_BROWSER_ROOT) {
        $env:BROWSER_MCP_SHARED_BROWSER_ROOT = $DefaultSharedBrowserRoot
    }

    if (-not $env:BROWSER_MCP_USER_DATA_DIR) {
        $env:BROWSER_MCP_USER_DATA_DIR = $DefaultSharedBrowserProfile
    }

    if (-not $env:BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER) {
        $env:BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER = if ($env:BROWSER_MCP_EXTERNAL_VISIBLE_CHROME) { $env:BROWSER_MCP_EXTERNAL_VISIBLE_CHROME } else { 'true' }
    }

    if (-not $env:BROWSER_MCP_EXTERNAL_VISIBLE_CHROME) {
        $env:BROWSER_MCP_EXTERNAL_VISIBLE_CHROME = $env:BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER
    }

    if (-not $env:BROWSER_MCP_REMOTE_DEBUGGING_PORT) {
        $env:BROWSER_MCP_REMOTE_DEBUGGING_PORT = '9223'
    }

    New-Item -ItemType Directory -Force -Path $env:BROWSER_MCP_SHARED_BROWSER_ROOT | Out-Null
    New-Item -ItemType Directory -Force -Path $env:BROWSER_MCP_USER_DATA_DIR | Out-Null
    New-Item -ItemType Directory -Force -Path $DefaultSharedBrowserRunDir | Out-Null
    New-Item -ItemType Directory -Force -Path $DefaultSharedBrowserLogDir | Out-Null
}

function Invoke-SharedBrowserOwner {
    param([Parameter(Mandatory = $true)][string]$BrowserCommand)

    Ensure-SharedBrowserEnvironment
    if (-not (Test-Path -LiteralPath $SharedBrowserOwnerScript)) {
        throw "Shared browser owner script was not found: $SharedBrowserOwnerScript"
    }

    $pwsh = Get-PwshCommand
    $output = & $pwsh.Source -NoProfile -ExecutionPolicy Bypass -File $SharedBrowserOwnerScript $BrowserCommand
    return ($output | ConvertFrom-Json)
}

function Start-SharedBrowserOwner {
    return Invoke-SharedBrowserOwner -BrowserCommand 'start'
}

function Stop-SharedBrowserOwner {
    return Invoke-SharedBrowserOwner -BrowserCommand 'stop'
}

function Restart-SharedBrowserOwner {
    return Invoke-SharedBrowserOwner -BrowserCommand 'restart'
}

function Get-SharedBrowserOwnerStatus {
    return Invoke-SharedBrowserOwner -BrowserCommand 'status'
}
