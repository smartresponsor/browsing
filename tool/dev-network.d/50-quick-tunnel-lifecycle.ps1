function Start-Tunnel {
    Ensure-Directories
    Start-Worker | Out-Null

    $cloudflared = Resolve-CloudflaredExe
    Remove-Item -LiteralPath $TunnelPidFile -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $TunnelLogFile -Value '' -Encoding utf8
    Set-Content -LiteralPath $TunnelErrFile -Value '' -Encoding utf8

    $workerPort = Get-WorkerPort
    $process = Start-Process `
        -FilePath $cloudflared `
        -ArgumentList @(
            'tunnel',
            '--url',
            "http://127.0.0.1:$workerPort",
            '--no-autoupdate',
            '--loglevel',
            'info'
        ) `
        -WorkingDirectory $Root `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $TunnelLogFile `
        -RedirectStandardError $TunnelErrFile

    Set-Content -LiteralPath $TunnelPidFile -Value $process.Id -NoNewline
    $deadline = (Get-Date).AddSeconds(60)
    $publicUrl = $null
    while ((Get-Date) -lt $deadline -and -not $publicUrl) {
        $publicUrl = Read-TunnelUrl
        if ($publicUrl) {
            break
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $publicUrl) {
        throw 'cloudflared did not publish a trycloudflare URL in time.'
    }

    return [pscustomobject]@{
        ok = $true
        public_url = $publicUrl
        worker_port = $workerPort
        tunnel = Get-TunnelState
    } | ConvertTo-Json -Depth 8
}

function Stop-Tunnel {
    Ensure-Directories
    $state = Get-TunnelState
    if ($state.pid) {
        Stop-TreeProcess -ProcessId $state.pid
    }

    Remove-Item -LiteralPath $TunnelPidFile -Force -ErrorAction SilentlyContinue
    return (Get-TunnelState | ConvertTo-Json -Depth 8)
}
