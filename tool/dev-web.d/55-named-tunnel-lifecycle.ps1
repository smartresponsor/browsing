function Start-NamedTunnel {
    Ensure-Directories
    Start-Worker | Out-Null

    $state = Get-NamedTunnelState
    if ($state.running) {
        return ($state | ConvertTo-Json -Depth 8)
    }

    $cloudflared = Resolve-CloudflaredExe
    $configPath = Get-NamedTunnelConfigPath
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Named tunnel config was not found: $configPath. Create it from ops\cloudflare\cloudflared.named.example.yml and keep credentials outside Git."
    }

    Remove-Item -LiteralPath $NamedTunnelPidFile -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $NamedTunnelLogFile -Value '' -Encoding utf8
    Set-Content -LiteralPath $NamedTunnelErrFile -Value '' -Encoding utf8

    $process = Start-Process `
        -FilePath $cloudflared `
        -ArgumentList @(
            'tunnel',
            '--config',
            $configPath,
            'run',
            (Get-NamedTunnelName)
        ) `
        -WorkingDirectory $Root `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $NamedTunnelLogFile `
        -RedirectStandardError $NamedTunnelErrFile

    Set-Content -LiteralPath $NamedTunnelPidFile -Value $process.Id -NoNewline
    Start-Sleep -Seconds 2

    $state = Get-NamedTunnelState
    if (-not $state.running) {
        throw 'Named Cloudflare tunnel did not stay running.'
    }

    return ($state | ConvertTo-Json -Depth 8)
}

function Stop-NamedTunnel {
    Ensure-Directories
    $state = Get-NamedTunnelState
    if ($state.pid) {
        Stop-TreeProcess -ProcessId $state.pid
    }

    Remove-Item -LiteralPath $NamedTunnelPidFile -Force -ErrorAction SilentlyContinue
    return (Get-NamedTunnelState | ConvertTo-Json -Depth 8)
}

function Install-NamedTunnelService {
    $cloudflared = Resolve-CloudflaredExe
    $configPath = Get-NamedTunnelConfigPath
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Named tunnel config was not found: $configPath. Create it from ops\cloudflare\cloudflared.named.example.yml first."
    }

    & $cloudflared service install --config $configPath
}
