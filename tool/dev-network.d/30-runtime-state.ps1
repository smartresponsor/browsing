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
        endpoint = if ($env:NETWORK_MCP_SERVER_ENDPOINT) { $env:NETWORK_MCP_SERVER_ENDPOINT } else { '/mcp' }
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

