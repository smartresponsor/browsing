function Ensure-Directories {
    foreach ($path in @($RunDir, $LogDir)) {
        New-Item -ItemType Directory -Force -Path $path | Out-Null
    }
}

function Get-NodeCommand {
    return (Get-Command node -ErrorAction Stop)
}

function Get-NpmCommand {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCmd) {
        return $npmCmd.Source
    }

    $npmExe = Get-Command npm.exe -ErrorAction SilentlyContinue
    if ($npmExe) {
        return $npmExe.Source
    }

    return (Get-Command npm -ErrorAction Stop).Source
}

function Get-PwshCommand {
    return (Get-Command pwsh -ErrorAction Stop)
}

function Test-TcpListener {
    param([Parameter(Mandatory = $true)][int]$Port)

    if ($IsLinux) {
        $listeners = & ss -H -ltn "sport = :$Port" 2>$null
        return [bool]$listeners
    }

    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Wait-ForTcpListener {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpListener -Port $Port) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }

    return $false
}

function Stop-TreeProcess {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $taskkill = Get-Command taskkill.exe -ErrorAction Stop
    & $taskkill.Source /PID $ProcessId /T /F | Out-Null
}

function Get-ProcessFromPidFile {
    param([Parameter(Mandatory = $true)][string]$PidFile)

    if (-not (Test-Path -LiteralPath $PidFile)) {
        return $null
    }

    $raw = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    $parsedPid = 0
    if (-not [int]::TryParse($raw, [ref]$parsedPid)) {
        return $null
    }

    try {
        return Get-Process -Id $parsedPid -ErrorAction Stop
    } catch {
        return $null
    }
}

function Get-ListeningProcessOnPort {
    param([Parameter(Mandatory = $true)][int]$Port)

    if ($IsLinux) {
        $ss = Get-Command ss -ErrorAction SilentlyContinue
        if (-not $ss) { return $null }
        $entries = & $ss.Source -H -ltnp "sport = :$Port" 2>$null
        foreach ($entry in @($entries)) {
            if ($entry -match 'pid=(\d+),') {
                return Get-Process -Id ([int]$Matches[1]) -ErrorAction SilentlyContinue
            }
        }
        return $null
    }
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::1', '::') } |
        Select-Object -First 1

    if (-not $connection) {
        return $null
    }

    return Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
}

function Get-CommandLine {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    if ($IsLinux) {
        $path = "/proc/$ProcessId/cmdline"
        if (-not (Test-Path -LiteralPath $path)) { return $null }
        try {
            $bytes = [System.IO.File]::ReadAllBytes($path)
            if ($bytes.Length -eq 0) { return $null }
            return [System.Text.Encoding]::UTF8.GetString($bytes).Replace([char]0, ' ').Trim()
        } catch {
            return $null
        }
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) {
        return $null
    }

    return [string]$process.CommandLine
}
