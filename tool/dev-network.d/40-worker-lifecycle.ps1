function Start-Worker {
    Ensure-Directories
    Ensure-SharedBrowserEnvironment

    $state = Get-WorkerState
    if ($state.running) {
        return $state
    }

    if ($state.port_conflict) {
        throw "playwright-worker cannot start because port $($state.port) is already in use by another process."
    }

    Remove-Item -LiteralPath $WorkerPidFile -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $WorkerLogFile -Value '' -Encoding utf8
    Set-Content -LiteralPath $WorkerErrFile -Value '' -Encoding utf8

    $node = Get-NodeCommand
    $workerScript = Join-Path $WorkerRoot 'src\worker.js'
    $restorePort = $env:PORT
    $env:PORT = [string](Get-WorkerPort)

    try {
        $process = Start-Process `
            -FilePath $node.Source `
            -ArgumentList @('--enable-source-maps', $workerScript) `
            -WorkingDirectory $Root `
            -PassThru
    } finally {
        if ($null -eq $restorePort) {
            Remove-Item -Path Env:PORT -ErrorAction SilentlyContinue
        } else {
            $env:PORT = $restorePort
        }
    }

    Set-Content -LiteralPath $WorkerPidFile -Value $process.Id -NoNewline
    if (-not (Wait-ForTcpListener -Port (Get-WorkerPort))) {
        throw 'playwright-worker did not start in time.'
    }

    return (Get-WorkerState | ConvertTo-Json -Depth 8)
}

function Stop-Worker {
    Ensure-Directories
    $state = Get-WorkerState
    if ($state.pid) {
        Stop-TreeProcess -ProcessId $state.pid
    }

    Remove-Item -LiteralPath $WorkerPidFile -Force -ErrorAction SilentlyContinue
    return (Get-WorkerState | ConvertTo-Json -Depth 8)
}
