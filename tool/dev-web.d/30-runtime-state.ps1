function Get-WorkerState {
    $pidProcess = Get-ProcessFromPidFile -PidFile $WorkerPidFile
    $listenerProcess = Get-ListeningProcessOnPort -Port (Get-WorkerPort)
    $listenerCommandLine = if ($listenerProcess) { Get-CommandLine -ProcessId $listenerProcess.Id } else { $null }
    $listenerMatches = $false
    if ($listenerCommandLine) {
        $listenerMatches = $listenerCommandLine -match '(?i)playwright-worker.*(src[\\/]+worker\.js|run\s+start)'
    }

    $process = $pidProcess
    if (-not $process -and $listenerMatches) {
        $process = $listenerProcess
    }

    [pscustomobject]@{
        name = 'playwright-worker'
        port = (Get-WorkerPort)
        pid_file = $WorkerPidFile
        pid = if ($process) { $process.Id } else { $null }
        running = [bool]$process
        port_open = [bool]$listenerProcess
        port_conflict = [bool]($listenerProcess -and -not $listenerMatches)
        listener_command_line = $listenerCommandLine
        command_line = if ($process) { Get-CommandLine -ProcessId $process.Id } else { $null }
        log_file = $WorkerLogFile
        error_file = $WorkerErrFile
    }
}

function Get-McpState {
    $pidProcess = Get-ProcessFromPidFile -PidFile $McpPidFile
    $listenerProcess = Get-ListeningProcessOnPort -Port (Get-McpPort)
    $listenerCommandLine = if ($listenerProcess) { Get-CommandLine -ProcessId $listenerProcess.Id } else { $null }
    $listenerMatches = $false
    if ($listenerCommandLine) {
        $listenerMatches = $listenerCommandLine -match '(?i)src[\\/]+server\.js'
    }

    $process = $pidProcess
    if (-not $process -and $listenerMatches) {
        $process = $listenerProcess
    }

    [pscustomobject]@{
        name = 'mcp-server'
        port = (Get-McpPort)
        endpoint = if ($env:BROWSER_MCP_SERVER_ENDPOINT) { $env:BROWSER_MCP_SERVER_ENDPOINT } else { '/mcp' }
        pid_file = $McpPidFile
        pid = if ($process) { $process.Id } else { $null }
        running = [bool]$process
        port_open = [bool]$listenerProcess
        port_conflict = [bool]($listenerProcess -and -not $listenerMatches)
        listener_command_line = $listenerCommandLine
        command_line = if ($process) { Get-CommandLine -ProcessId $process.Id } else { $null }
        log_file = $McpLogFile
        error_file = $McpErrFile
    }
}

function Get-TunnelState {
    $pidProcess = Get-ProcessFromPidFile -PidFile $TunnelPidFile
    $commandLineProcess = $null
    if (-not $pidProcess) {
        $commandLineProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match 'cloudflared\b.*\btunnel\b.*\b--url\b.*127\.0\.0\.1' } |
            Select-Object -First 1
    }

    $process = $pidProcess
    if (-not $process -and $commandLineProcess) {
        $process = Get-Process -Id $commandLineProcess.ProcessId -ErrorAction SilentlyContinue
    }

    [pscustomobject]@{
        name = 'cloudflared'
        pid_file = $TunnelPidFile
        pid = if ($process) { $process.Id } else { $null }
        running = [bool]$process
        command_line = if ($process) { Get-CommandLine -ProcessId $process.Id } else { $null }
        log_file = $TunnelLogFile
        error_file = $TunnelErrFile
    }
}

function Read-TunnelUrl {
    foreach ($path in @($TunnelLogFile, $TunnelErrFile)) {
        if (-not (Test-Path -LiteralPath $path)) {
            continue
        }

        $text = Get-Content -LiteralPath $path -Raw
        if ($text -match 'https://[a-z0-9.-]+\.trycloudflare\.com') {
            return $Matches[0]
        }
    }

    return $null
}

function Get-NamedTunnelState {
    $pidProcess = Get-ProcessFromPidFile -PidFile $NamedTunnelPidFile
    $commandLineProcess = $null
    if (-not $pidProcess) {
        $tunnelName = [regex]::Escape((Get-NamedTunnelName))
        $commandLineProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -match "cloudflared.*tunnel.*run.*$tunnelName" } |
            Select-Object -First 1
    }

    $process = $pidProcess
    if (-not $process -and $commandLineProcess) {
        $process = Get-Process -Id $commandLineProcess.ProcessId -ErrorAction SilentlyContinue
    }

    [pscustomobject]@{
        name = 'cloudflared-named'
        tunnel_name = Get-NamedTunnelName
        hostname = Get-NamedTunnelHostname
        config_file = Get-NamedTunnelConfigPath
        pid_file = $NamedTunnelPidFile
        pid = if ($process) { $process.Id } else { $null }
        running = [bool]$process
        command_line = if ($process) { Get-CommandLine -ProcessId $process.Id } else { $null }
        log_file = $NamedTunnelLogFile
        error_file = $NamedTunnelErrFile
    }
}

