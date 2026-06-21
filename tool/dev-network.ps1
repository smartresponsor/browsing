[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet(
        'doctor',
        'doctor-json',
        'status',
        'start',
        'stop',
        'restart',
        'smoke-local',
        'smoke-public',
        'tail-server-log',
        'tail-tunnel-log',
        'check-cloudflared',
        'check-wrangler',
        'deploy-worker',
        'install-startup-task',
        'uninstall-startup-task',
        'show-startup-task'
    )]
    [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$WorkerRoot = Join-Path $Root 'playwright-worker'
$CloudflareWorkerRoot = Join-Path $Root 'cloudflare-worker'
$RunDir = Join-Path $Root 'var\run'
$LogDir = Join-Path $Root 'var\log'
$WorkerPidFile = Join-Path $RunDir 'playwright-worker.pid'
$TunnelPidFile = Join-Path $RunDir 'cloudflared.pid'
$WorkerLogFile = Join-Path $LogDir 'playwright-worker.log'
$WorkerErrFile = Join-Path $LogDir 'playwright-worker.err.log'
$TunnelLogFile = Join-Path $LogDir 'cloudflared.log'
$TunnelErrFile = Join-Path $LogDir 'cloudflared.err.log'
$StartupTaskName = 'network-mcp-dev'
$StartupTaskPath = '\'

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

function Get-WorkerPort {
    if ($env:NETWORK_MCP_WORKER_PORT) {
        return [int]$env:NETWORK_MCP_WORKER_PORT
    }

    return 8791
}

function Test-TcpListener {
    param([Parameter(Mandatory = $true)][int]$Port)

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

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) {
        return $null
    }

    return [string]$process.CommandLine
}

function Resolve-CloudflaredExe {
    $candidates = @()

    if ($env:NETWORK_MCP_CLOUDFLARED_BIN) {
        $candidates += $env:NETWORK_MCP_CLOUDFLARED_BIN.Trim()
    }

    $candidates += 'C:\Tools\cloudflared\cloudflared.exe'

    $pathCommand = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if ($pathCommand) {
        $candidates += $pathCommand.Source
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    throw 'cloudflared.exe was not found. Set NETWORK_MCP_CLOUDFLARED_BIN, install it at C:\Tools\cloudflared\cloudflared.exe, or add it to PATH.'
}

function Resolve-WranglerExe {
    $candidates = @(
        (Join-Path $Root 'node_modules\.bin\wrangler.cmd'),
        (Join-Path $Root 'node_modules\.bin\wrangler.exe')
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    $command = Get-Command wrangler -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw 'wrangler was not found. Run npm install at the repo root so node_modules\.bin\wrangler is available, or add wrangler to PATH.'
}

function Test-CloudflaredAvailable {
    try {
        Resolve-CloudflaredExe | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Get-CloudflaredBinary {
    try {
        return Resolve-CloudflaredExe
    } catch {
        return $null
    }
}

function Test-WranglerAvailable {
    try {
        Resolve-WranglerExe | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Get-WranglerBinary {
    try {
        return Resolve-WranglerExe
    } catch {
        return $null
    }
}

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

function Get-PolicyState {
    $allowedHosts = @()
    if ($env:NETWORK_MCP_ALLOWED_HOSTS) {
        $allowedHosts = $env:NETWORK_MCP_ALLOWED_HOSTS -split '[,;\r\n]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }
    }

    $deniedHosts = @()
    if ($env:NETWORK_MCP_DENIED_HOSTS) {
        $deniedHosts = $env:NETWORK_MCP_DENIED_HOSTS -split '[,;\r\n]+' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_.Trim() }
    }

    $warnings = @()
    if ($env:NETWORK_MCP_HEADLESS -eq 'true') {
        $warnings += 'NETWORK_MCP_HEADLESS is true; the MVP expects a visible browser by default.'
    }
    if ($env:NETWORK_MCP_REQUIRE_APPROVAL_FOR_FILL -eq 'false') {
        $warnings += 'NETWORK_MCP_REQUIRE_APPROVAL_FOR_FILL is false; fill actions should remain approval-gated.'
    }
    if ($env:NETWORK_MCP_REQUIRE_APPROVAL_FOR_SUBMIT -eq 'false') {
        $warnings += 'NETWORK_MCP_REQUIRE_APPROVAL_FOR_SUBMIT is false; submit should remain explicitly gated.'
    }
    if ($env:NETWORK_MCP_SUBMIT_DEFAULT -eq 'true') {
        $warnings += 'NETWORK_MCP_SUBMIT_DEFAULT is true; the MVP expects submit to stay disabled by default.'
    }
    if ($env:NETWORK_MCP_ENABLE_SUBMIT -eq 'true') {
        $warnings += 'NETWORK_MCP_ENABLE_SUBMIT is true; submit mode should remain off unless explicitly enabled later.'
    }

    $maxSessionSeconds = if ($env:NETWORK_MCP_MAX_SESSION_SECONDS) { [int]$env:NETWORK_MCP_MAX_SESSION_SECONDS } else { 900 }
    $maxPageVisits = if ($env:NETWORK_MCP_MAX_PAGE_VISITS) { [int]$env:NETWORK_MCP_MAX_PAGE_VISITS } else { 20 }
    $maxFormFills = if ($env:NETWORK_MCP_MAX_FORM_FILLS) { [int]$env:NETWORK_MCP_MAX_FORM_FILLS } else { 1 }
    $maxFieldWrites = if ($env:NETWORK_MCP_MAX_FIELD_WRITES) { [int]$env:NETWORK_MCP_MAX_FIELD_WRITES } else { 80 }

    if ($maxSessionSeconds -le 0) {
        $warnings += 'NETWORK_MCP_MAX_SESSION_SECONDS must be greater than zero.'
    }
    if ($maxPageVisits -le 0) {
        $warnings += 'NETWORK_MCP_MAX_PAGE_VISITS must be greater than zero.'
    }
    if ($maxFormFills -le 0) {
        $warnings += 'NETWORK_MCP_MAX_FORM_FILLS must be greater than zero.'
    }
    if ($maxFieldWrites -le 0) {
        $warnings += 'NETWORK_MCP_MAX_FIELD_WRITES must be greater than zero.'
    }

    [pscustomobject]@{
        mode = if ($env:NETWORK_MCP_MODE) { $env:NETWORK_MCP_MODE } else { 'local-assist' }
        headless = [bool]($env:NETWORK_MCP_HEADLESS -eq 'true')
        require_approval_for_fill = -not ($env:NETWORK_MCP_REQUIRE_APPROVAL_FOR_FILL -eq 'false')
        require_approval_for_submit = -not ($env:NETWORK_MCP_REQUIRE_APPROVAL_FOR_SUBMIT -eq 'false')
        submit_default = [bool]($env:NETWORK_MCP_SUBMIT_DEFAULT -eq 'true')
        enable_submit = [bool]($env:NETWORK_MCP_ENABLE_SUBMIT -eq 'true')
        max_session_seconds = $maxSessionSeconds
        max_page_visits = $maxPageVisits
        max_form_fills = $maxFormFills
        max_field_writes = $maxFieldWrites
        allowed_hosts = $allowedHosts
        denied_hosts = $deniedHosts
        warnings = $warnings
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

function Start-Worker {
    Ensure-Directories

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
            -PassThru `
            -WindowStyle Hidden `
            -RedirectStandardOutput $WorkerLogFile `
            -RedirectStandardError $WorkerErrFile
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

function Start-Stack {
    $worker = Start-Worker
    $tunnel = Start-Tunnel | ConvertFrom-Json
    [pscustomobject]@{
        ok = $true
        worker = $worker | ConvertFrom-Json
        tunnel = $tunnel
    } | ConvertTo-Json -Depth 8
}

function Stop-Stack {
    $tunnel = Stop-Tunnel | ConvertFrom-Json
    $worker = Stop-Worker | ConvertFrom-Json
    [pscustomobject]@{
        ok = $true
        worker = $worker
        tunnel = $tunnel
    } | ConvertTo-Json -Depth 8
}

function Invoke-WorkerRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Body
    )

    $port = Get-WorkerPort
    $uri = "http://127.0.0.1:$port$Path"
    $headers = @{}
    if ($env:NETWORK_MCP_BROWSER_WORKER_TOKEN) {
        $headers['Authorization'] = "Bearer $($env:NETWORK_MCP_BROWSER_WORKER_TOKEN)"
    }

    $response = Invoke-WebRequest -Method Post -Uri $uri -ContentType 'application/json' -Headers $headers -Body $Body -SkipHttpErrorCheck -TimeoutSec 30

    return [pscustomobject]@{
        status_code = [int]$response.StatusCode
        content = $response.Content
    }
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return (([System.Net.IPEndPoint]$listener.LocalEndpoint).Port)
    } finally {
        $listener.Stop()
    }
}

function Start-SmokeFormServer {
    $port = Get-FreeTcpPort
    $formHtml = @'
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Network MCP Smoke</title></head>
  <body>
    <form>
      <label for="full_name">Name</label>
      <input id="full_name" name="full_name" type="text" value="">
      <label for="summary">Summary</label>
      <textarea id="summary" name="summary"></textarea>
      <button type="button">Next</button>
      <button type="submit">Submit</button>
    </form>
  </body>
</html>
'@
    $job = Start-Job -ArgumentList $port, $formHtml -ScriptBlock {
        param([int]$JobPort, [string]$JobHtml)

        $listener = [System.Net.HttpListener]::new()
        $listener.Prefixes.Add("http://127.0.0.1:$JobPort/")
        $listener.Start()

        try {
            while ($listener.IsListening) {
                $context = $listener.GetContext()
                $response = $context.Response
                $buffer = [System.Text.Encoding]::UTF8.GetBytes($JobHtml)
                $response.StatusCode = 200
                $response.ContentType = 'text/html; charset=utf-8'
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
                $response.OutputStream.Close()
            }
        } finally {
            if ($listener.IsListening) {
                $listener.Stop()
            }
            $listener.Close()
        }
    }

    if (-not (Wait-ForTcpListener -Port $port)) {
        if ($job) {
            Stop-Job -Job $job -ErrorAction SilentlyContinue | Out-Null
            Remove-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null
        }
        throw 'Smoke form server did not start in time.'
    }

    return [pscustomobject]@{
        job_id = $job.Id
        port = $port
    }
}

function Start-SmokeFormTunnel {
    param(
        [Parameter(Mandatory = $true)][int]$Port
    )

    $cloudflared = Resolve-CloudflaredExe
    $smokeTunnelStdout = Join-Path $LogDir 'smoke-form-tunnel.log'
    $smokeTunnelStderr = Join-Path $LogDir 'smoke-form-tunnel.err.log'
    Set-Content -LiteralPath $smokeTunnelStdout -Value '' -Encoding utf8
    Set-Content -LiteralPath $smokeTunnelStderr -Value '' -Encoding utf8

    $process = Start-Process `
        -FilePath $cloudflared `
        -ArgumentList @(
            'tunnel',
            '--url',
            "http://127.0.0.1:$Port",
            '--no-autoupdate',
            '--loglevel',
            'info'
        ) `
        -WorkingDirectory $Root `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $smokeTunnelStdout `
        -RedirectStandardError $smokeTunnelStderr

    $deadline = (Get-Date).AddSeconds(60)
    $publicUrl = $null
    while ((Get-Date) -lt $deadline -and -not $publicUrl) {
        foreach ($path in @($smokeTunnelStdout, $smokeTunnelStderr)) {
            if (-not (Test-Path -LiteralPath $path)) {
                continue
            }

            $text = Get-Content -LiteralPath $path -Raw
            if ($text -match 'https://[a-z0-9.-]+\.trycloudflare\.com') {
                $publicUrl = $Matches[0]
                break
            }
        }

        if ($publicUrl) {
            break
        }

        Start-Sleep -Milliseconds 500
    }

    if (-not $publicUrl) {
        Stop-TreeProcess -ProcessId $process.Id
        throw 'Smoke form tunnel did not publish a trycloudflare URL in time.'
    }

    return [pscustomobject]@{
        pid = $process.Id
        public_url = $publicUrl
    }
}

function Invoke-LocalSmoke {
    Start-Worker | Out-Null
    $result = $null
    try {
        $formUrl = 'https://www.scale.at/blog/html-forms'

        $open = Invoke-WorkerRequest -Path '/open' -Body (@{ url = $formUrl } | ConvertTo-Json)
        Start-Sleep -Seconds 4
        $inspect = Invoke-WorkerRequest -Path '/inspect' -Body '{}'
        $extract = Invoke-WorkerRequest -Path '/extract-form' -Body '{}'

        $inspectBody = $inspect.content | ConvertFrom-Json
        $safeFields = @($inspectBody.fields | Where-Object { $_.visible -eq $true -and $_.enabled -eq $true -and $_.safeEditable -eq $true -and [string]::IsNullOrWhiteSpace($_.blockedReason) })
        if ($safeFields.Count -lt 2) {
            throw 'Local smoke did not find at least two safe editable fields on the sample form.'
        }

        $fillFields = @(
            @{ index = [int]$safeFields[0].index; name = $safeFields[0].name; value = 'Jane Doe' },
            @{ index = [int]$safeFields[1].index; name = $safeFields[1].name; value = 'Experienced applicant' }
        )

        $propose = Invoke-WorkerRequest -Path '/propose' -Body (@{
            fields = @(
                @{ index = $fillFields[0].index; name = $fillFields[0].name; value = $fillFields[0].value },
                @{ index = $fillFields[1].index; name = $fillFields[1].name; value = $fillFields[1].value }
            )
        } | ConvertTo-Json -Depth 5)

        $rejected = Invoke-WorkerRequest -Path '/fill-after-approval' -Body (@{
            approved = $false
            approvalText = 'APPLY'
            fields = @(@{ index = $fillFields[0].index; value = $fillFields[0].value })
        } | ConvertTo-Json -Depth 5)

        $fill = Invoke-WorkerRequest -Path '/fill-after-approval' -Body (@{
            approved = $true
            approvalText = 'APPLY'
            fields = $fillFields | ForEach-Object { @{ index = $_.index; name = $_.name; value = $_.value } }
        } | ConvertTo-Json -Depth 5)

        $review = Invoke-WorkerRequest -Path '/review-before-submit' -Body '{}'

        $result = [pscustomobject]@{
            ok = $open.status_code -eq 200 -and $inspect.status_code -eq 200 -and $extract.status_code -eq 200 -and $propose.status_code -eq 200 -and $rejected.status_code -eq 409 -and $fill.status_code -eq 200 -and $review.status_code -eq 200
            open = $open
            inspect = $inspect
            extract = $extract
            propose = $propose
            rejected = $rejected
            fill = $fill
            review = $review
        }
    } finally {
        Stop-Worker | Out-Null
        Start-Worker | Out-Null
    }

    return ($result | ConvertTo-Json -Depth 8)
}

function Invoke-PublicSmoke {
    if ([string]::IsNullOrWhiteSpace($env:NETWORK_MCP_PUBLIC_ORIGIN)) {
        return [pscustomobject]@{
            ok = $false
            skipped = $true
            reason = 'NETWORK_MCP_PUBLIC_ORIGIN is not configured.'
        } | ConvertTo-Json -Depth 4
    }

    $origin = $env:NETWORK_MCP_PUBLIC_ORIGIN.TrimEnd('/')
    $response = Invoke-WebRequest -Method Get -Uri "$origin/healthz" -SkipHttpErrorCheck -TimeoutSec 30
    $body = $null
    try {
        $body = $response.Content | ConvertFrom-Json
    } catch {
        $body = $response.Content
    }

    return [pscustomobject]@{
        ok = [int]$response.StatusCode -eq 200 -and $body.ok -eq $true -and $body.service -eq 'network-career-gateway'
        status_code = [int]$response.StatusCode
        body = $body
        origin = $origin
    } | ConvertTo-Json -Depth 8
}

function Show-Status {
    $workerState = Get-WorkerState
    $tunnelState = Get-TunnelState
    $localSmoke = if ($workerState.running) { Invoke-LocalSmoke | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } }
    $publicSmoke = if ($env:NETWORK_MCP_PUBLIC_ORIGIN) { Invoke-PublicSmoke | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'NETWORK_MCP_PUBLIC_ORIGIN is not configured.' } }
    $policy = Get-PolicyState

    $status = [pscustomobject]@{
        repo_root = $Root
        policy = $policy
        worker = $workerState
        tunnel = $tunnelState
        wrangler = [pscustomobject]@{
            available = Test-WranglerAvailable
            binary = Get-WranglerBinary
        }
        cloudflared = [pscustomobject]@{
            available = Test-CloudflaredAvailable
            binary = Get-CloudflaredBinary
        }
        smoke = [pscustomobject]@{
            local = $localSmoke
            public = $publicSmoke
        }
    }

    Write-Output ($status | ConvertTo-Json -Depth 10)
}

function Show-Doctor {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    $workerState = Get-WorkerState
    $tunnelState = Get-TunnelState
    $workerSmoke = if ($workerState.running) { (Invoke-LocalSmoke | ConvertFrom-Json).ok } else { $false }
    $publicSmoke = if ($env:NETWORK_MCP_PUBLIC_ORIGIN) { (Invoke-PublicSmoke | ConvertFrom-Json).ok } else { $false }
    $policy = Get-PolicyState

    $summary = @(
        "repo_root: $Root"
        "policy_mode: $($policy.mode)"
        "policy_headless: $($policy.headless)"
        "policy_require_approval_for_fill: $($policy.require_approval_for_fill)"
        "policy_require_approval_for_submit: $($policy.require_approval_for_submit)"
        "policy_submit_default: $($policy.submit_default)"
        "policy_enable_submit: $($policy.enable_submit)"
        "policy_max_session_seconds: $($policy.max_session_seconds)"
        "policy_max_page_visits: $($policy.max_page_visits)"
        "policy_max_form_fills: $($policy.max_form_fills)"
        "policy_max_field_writes: $($policy.max_field_writes)"
        "node_available: $([bool]$node)"
        "npm_available: $([bool]$npm)"
        "pwsh_available: $([bool]$pwsh)"
        "wrangler_available: $(Test-WranglerAvailable)"
        "cloudflared_available: $(Test-CloudflaredAvailable)"
        "worker_port: $($workerState.port)"
        "worker_running: $($workerState.running)"
        "tunnel_running: $($tunnelState.running)"
        "public_origin_configured: $([bool]$env:NETWORK_MCP_PUBLIC_ORIGIN)"
        "local_smoke_ok: $workerSmoke"
        "public_smoke_ok: $publicSmoke"
    )

    if ($policy.warnings.Count -gt 0) {
        $summary += 'policy_warnings:'
        foreach ($warning in $policy.warnings) {
            $summary += "  - $warning"
        }
    }

    Write-Output ($summary -join [Environment]::NewLine)
}

function Show-DoctorJson {
    return (Show-Status | ConvertFrom-Json | ConvertTo-Json -Depth 10)
}

function Check-Cloudflared {
    $binary = Resolve-CloudflaredExe
    return [pscustomobject]@{
        available = $true
        binary = $binary
    } | ConvertTo-Json -Depth 4
}

function Check-Wrangler {
    $binary = Resolve-WranglerExe
    $apiTokenPresent = [bool]$env:CLOUDFLARE_API_TOKEN
    $accountIdPresent = [bool]$env:CLOUDFLARE_ACCOUNT_ID
    $version = $null
    try {
        $version = (& $binary --version 2>$null | Select-Object -First 1)
    } catch {
        $version = $null
    }

    return [pscustomobject]@{
        available = $true
        binary = $binary
        version = $version
        cloudflare_api_token_present = $apiTokenPresent
        cloudflare_account_id_present = $accountIdPresent
    } | ConvertTo-Json -Depth 4
}

function Deploy-Worker {
    $wrangler = Resolve-WranglerExe
    $config = Join-Path $CloudflareWorkerRoot 'wrangler.jsonc'
    if (-not (Test-Path -LiteralPath $config)) {
        throw "wrangler config not found: $config"
    }

    Push-Location $CloudflareWorkerRoot
    try {
        & $wrangler deploy --config $config
    } finally {
        Pop-Location
    }
}

function Install-StartupTask {
    Import-Module ScheduledTasks -ErrorAction Stop
    $pwsh = Get-PwshCommand
    $scriptPath = Join-Path $Root 'tool\dev-network.ps1'
    $action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" start" -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $StartupTaskName -TaskPath $StartupTaskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start the network-mcp local worker and tunnel at logon.' -Force | Out-Null
    return (Show-StartupTask)
}

function Uninstall-StartupTask {
    Import-Module ScheduledTasks -ErrorAction Stop
    $existing = Get-ScheduledTask -TaskName $StartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $StartupTaskName -TaskPath $StartupTaskPath -Confirm:$false | Out-Null
    }

    return [pscustomobject]@{
        task_name = $StartupTaskName
        removed = [bool]$existing
    } | ConvertTo-Json -Depth 4
}

function Show-StartupTask {
    Import-Module ScheduledTasks -ErrorAction Stop
    $task = Get-ScheduledTask -TaskName $StartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
    if (-not $task) {
        return [pscustomobject]@{
            task_name = $StartupTaskName
            task_path = $StartupTaskPath
            exists = $false
        } | ConvertTo-Json -Depth 4
    }

    $info = Get-ScheduledTaskInfo -TaskName $StartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
    $action = $task.Actions | Select-Object -First 1
    $trigger = $task.Triggers | Select-Object -First 1

    return [pscustomobject]@{
        task_name = $StartupTaskName
        task_path = $StartupTaskPath
        exists = $true
        state = [string]$task.State
        last_run_time = if ($info) { $info.LastRunTime } else { $null }
        next_run_time = if ($info) { $info.NextRunTime } else { $null }
        last_task_result = if ($info) { $info.LastTaskResult } else { $null }
        action = if ($action) {
            [pscustomobject]@{
                execute = $action.Execute
                arguments = $action.Arguments
                working_directory = $action.WorkingDirectory
            }
        } else {
            $null
        }
        trigger = if ($trigger) {
            [pscustomobject]@{
                enabled = $trigger.Enabled
                start_boundary = $trigger.StartBoundary
            }
        } else {
            $null
        }
    } | ConvertTo-Json -Depth 6
}

switch ($Command) {
    'doctor' { Show-Doctor }
    'doctor-json' { Show-DoctorJson }
    'status' { Show-Status }
    'start' { Start-Stack }
    'stop' { Stop-Stack }
    'restart' {
        Stop-Stack | Out-Null
        Start-Stack
    }
    'smoke-local' { Invoke-LocalSmoke }
    'smoke-public' { Invoke-PublicSmoke }
    'tail-server-log' {
        $latest = Get-ChildItem -LiteralPath $LogDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match 'playwright-worker|cloudflared' } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if (-not $latest) {
            Write-Output 'No server logs found.'
            break
        }

        Write-Output "Tailing $($latest.FullName)"
        Get-Content -LiteralPath $latest.FullName -Tail 100 -Wait
    }
    'tail-tunnel-log' {
        if (Test-Path -LiteralPath $TunnelLogFile) {
            Get-Content -LiteralPath $TunnelLogFile -Tail 100 -Wait
        } else {
            Write-Output 'No tunnel log found.'
        }
    }
    'check-cloudflared' { Check-Cloudflared }
    'check-wrangler' { Check-Wrangler }
    'deploy-worker' { Deploy-Worker }
    'install-startup-task' { Install-StartupTask }
    'uninstall-startup-task' { Uninstall-StartupTask }
    'show-startup-task' { Show-StartupTask }
}
