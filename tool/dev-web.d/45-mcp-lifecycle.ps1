function Start-McpServer {
    Ensure-Directories

    $state = Get-McpState
    if ($state.running) {
        return $state
    }

    if ($state.port_conflict) {
        throw "mcp-server cannot start because port $($state.port) is already in use by another process."
    }

    if (-not (Test-Path -LiteralPath (Join-Path $McpRoot 'node_modules'))) {
        throw 'mcp-server dependencies are not installed. Run: npm --prefix mcp-server install'
    }

    Remove-Item -LiteralPath $McpPidFile -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $McpLogFile -Value '' -Encoding utf8
    Set-Content -LiteralPath $McpErrFile -Value '' -Encoding utf8

    $node = Get-NodeCommand
    $mcpScript = Join-Path $McpRoot 'src\server.js'
    $restorePort = $env:BROWSER_MCP_SERVER_PORT
    $env:BROWSER_MCP_SERVER_PORT = [string](Get-McpPort)

    try {
        $process = Start-Process `
            -FilePath $node.Source `
            -ArgumentList @('--enable-source-maps', $mcpScript) `
            -WorkingDirectory $McpRoot `
            -PassThru `
            -WindowStyle Hidden `
            -RedirectStandardOutput $McpLogFile `
            -RedirectStandardError $McpErrFile
    } finally {
        if ($null -eq $restorePort) {
            Remove-Item -Path Env:BROWSER_MCP_SERVER_PORT -ErrorAction SilentlyContinue
        } else {
            $env:BROWSER_MCP_SERVER_PORT = $restorePort
        }
    }

    Set-Content -LiteralPath $McpPidFile -Value $process.Id -NoNewline
    if (-not (Wait-ForTcpListener -Port (Get-McpPort))) {
        throw 'mcp-server did not start in time.'
    }

    return (Get-McpState | ConvertTo-Json -Depth 8)
}

function Stop-McpServer {
    Ensure-Directories
    $state = Get-McpState
    if ($state.pid) {
        Stop-TreeProcess -ProcessId $state.pid
    }

    Remove-Item -LiteralPath $McpPidFile -Force -ErrorAction SilentlyContinue
    return (Get-McpState | ConvertTo-Json -Depth 8)
}
