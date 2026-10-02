[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet(
        'doctor',
        'doctor-json',
        'status',
        'runtime-doctor',
        'runtime-recover',
        'watch-tick',
        'watch-status',
        'shared-browser-status',
        'browser-cdp-targets',
        'browser-cdp-cleanup-plan',
        'browser-cdp-cleanup-blocked',
        'browser-cdp-cleanup-confirmed',
        'shared-browser-start',
        'shared-browser-stop',
        'shared-browser-restart',
        'start',
        'stop',
        'start-visible-worker',
        'restart-worker',
        'restart',
        'start-mcp',
        'stop-mcp',
        'restart-mcp',
        'smoke-local',
        'smoke-public',
        'smoke-mcp',
        'tail-server-log',
        'tail-tunnel-log',
        'start-named-tunnel',
        'stop-named-tunnel',
        'named-tunnel-status',
        'install-named-tunnel-service',
        'check-cloudflared',
        'check-wrangler',
        'deploy-worker',
        'install-startup-task',
        'uninstall-startup-task',
        'show-startup-task',
        'install-mcp-startup-task',
        'start-mcp-startup-task',
        'stop-mcp-startup-task',
        'uninstall-mcp-startup-task',
        'show-mcp-startup-task'
    )]
    [string]$Command = 'status'
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$NetworkRoot = $Root
$WorkerRoot = Join-Path $Root 'playwright-worker'
$McpRoot = Join-Path $Root 'mcp-server'
$CloudflareWorkerRoot = Join-Path $Root 'cloudflare-worker'
$RunDir = Join-Path $Root 'var\run'
$LogDir = Join-Path $Root 'var\log'
$WorkerPidFile = Join-Path $RunDir 'playwright-worker.pid'
$McpPidFile = Join-Path $RunDir 'mcp-server.pid'
$TunnelPidFile = Join-Path $RunDir 'cloudflared.pid'
$WorkerLogFile = Join-Path $LogDir 'playwright-worker.log'
$WorkerErrFile = Join-Path $LogDir 'playwright-worker.err.log'
$McpLogFile = Join-Path $LogDir 'mcp-server.log'
$McpErrFile = Join-Path $LogDir 'mcp-server.err.log'
$TunnelLogFile = Join-Path $LogDir 'cloudflared.log'
$TunnelErrFile = Join-Path $LogDir 'cloudflared.err.log'
$NamedTunnelPidFile = Join-Path $RunDir 'cloudflared-named.pid'
$NamedTunnelLogFile = Join-Path $LogDir 'cloudflared-named.log'
$NamedTunnelErrFile = Join-Path $LogDir 'cloudflared-named.err.log'
$StartupTaskName = 'browser-mcp-dev'
$McpStartupTaskName = 'browser-mcp-server'
$StartupTaskPath = '\'
$RuntimeStateFile = Join-Path $RunDir 'network-runtime.json'
$WatchdogStateFile = Join-Path $RunDir 'network-watchdog-state.json'
$WatchdogLogFile = Join-Path $LogDir 'network-watchdog.ndjson'
$DefaultMcpPublicOrigin = ''
$LegacySmartresponsorOrigin = 'https://network.smartresponsor.com'
$DefaultSharedBrowserRoot = Join-Path (Split-Path -Parent $Root) 'browser'
$DefaultSharedBrowserProfile = Join-Path $DefaultSharedBrowserRoot 'profile'
$DefaultSharedBrowserRunDir = Join-Path $DefaultSharedBrowserRoot 'run'
$DefaultSharedBrowserLogDir = Join-Path $DefaultSharedBrowserRoot 'log'
$SharedBrowserRuntimeFile = Join-Path $DefaultSharedBrowserRunDir 'browser-runtime.json'
$NetworkBrowserClientRuntimeFile = Join-Path $DefaultSharedBrowserRunDir 'browser-mcp-browser-client.json'
$SharedBrowserOwnerScript = Join-Path $Root 'tool\shared-browser.ps1'
$McpWorkspaceRoot = Split-Path -Parent $Root
$SharedSecretRuntime = Join-Path $McpWorkspaceRoot 'AwsSecretContract\tool\secret-runtime.ps1'
$RequestedSupervisorCommand = $Command
if (Test-Path -LiteralPath $SharedSecretRuntime -PathType Leaf) {
    . $SharedSecretRuntime -Command export-env -Consumer browser-mcp -IncludePrevious
}
$Root = $NetworkRoot
$Command = $RequestedSupervisorCommand

. (Join-Path $PSScriptRoot 'dev-network.d\20-process-support.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\25-runtime-config.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\27-command-resolution.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\28-shared-browser-support.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\30-runtime-state.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\35-policy-state.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\40-worker-lifecycle.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\45-mcp-lifecycle.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\47-mcp-persistent-task.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\50-quick-tunnel-lifecycle.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\55-named-tunnel-lifecycle.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\60-stack-lifecycle.ps1')
. (Join-Path $PSScriptRoot 'dev-network.d\65-worker-request.ps1')

if (-not (Get-Item -Path Env:BROWSER_MCP_PUBLIC_ORIGIN -ErrorAction SilentlyContinue)) {
    Set-Item -Path Env:BROWSER_MCP_PUBLIC_ORIGIN -Value (Get-PublicOrigin)
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
  <head><meta charset="utf-8"><title>Browser MCP Smoke</title></head>
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

function Invoke-McpSmoke {
    $state = Get-McpState
    if (-not $state.running) {
        return [pscustomobject]@{
            ok = $false
            skipped = $true
            reason = 'mcp-server is not running.'
        } | ConvertTo-Json -Depth 4
    }

    $endpoint = if ($env:BROWSER_MCP_SERVER_ENDPOINT) { $env:BROWSER_MCP_SERVER_ENDPOINT } else { '/mcp' }
    $uri = "http://127.0.0.1:$($state.port)$endpoint"

    $initializeBody = @{
        jsonrpc = '2.0'
        id = 1
        method = 'initialize'
        params = @{
            protocolVersion = '2025-11-25'
            capabilities = @{}
            clientInfo = @{
                name = 'browser-mcp-dev-network'
                version = '0.1.0'
            }
        }
    } | ConvertTo-Json -Depth 8

    $toolsBody = @{
        jsonrpc = '2.0'
        id = 2
        method = 'tools/list'
        params = @{}
    } | ConvertTo-Json -Depth 8

    $jsonMediaType = [string]::Join('', @('application', '/', 'json'))
    $streamMediaType = [string]::Join('', @('text', '/', 'event', '-', 'stream'))
    $headers = @{}
    $headers[[string]::Join('', @('A', 'c', 'c', 'e', 'p', 't'))] = [string]::Join(', ', @($jsonMediaType, $streamMediaType))

    $initialize = Invoke-WebRequest -Method Post -Uri $uri -ContentType 'application/json' -Headers $headers -Body $initializeBody -SkipHttpErrorCheck -TimeoutSec 30
    $tools = Invoke-WebRequest -Method Post -Uri $uri -ContentType 'application/json' -Headers $headers -Body $toolsBody -SkipHttpErrorCheck -TimeoutSec 30

    $initializeBodyParsed = $null
    $toolsBodyParsed = $null
    try { $initializeBodyParsed = $initialize.Content | ConvertFrom-Json } catch { $initializeBodyParsed = $initialize.Content }
    try { $toolsBodyParsed = $tools.Content | ConvertFrom-Json } catch { $toolsBodyParsed = $tools.Content }
    $requiredTools = @('network.open', 'network.browser_cdp_targets', 'network.browser_cdp_verify_chatgpt_home', 'network.browser_cdp_cleanup_plan_chatgpt_home', 'network.browser_cdp_cleanup_chatgpt_home', 'network.surface_plan', 'network.surface_execute')
    $missingTools = @($requiredTools | Where-Object { -not $tools.Content.Contains($_) })
    $toolsResponseHasRequiredTools = $missingTools.Count -eq 0

    return [pscustomobject]@{
        ok = [int]$initialize.StatusCode -eq 200 -and [int]$tools.StatusCode -eq 200 -and $toolsResponseHasRequiredTools
        endpoint = $uri
        initialize = @{ status_code = [int]$initialize.StatusCode; body = $initializeBodyParsed }
        tools = @{ status_code = [int]$tools.StatusCode; body = $toolsBodyParsed }
        required_tools = $requiredTools
        missing_tools = $missingTools
    } | ConvertTo-Json -Depth 12
}

function Invoke-PublicSmoke {
    if ([string]::IsNullOrWhiteSpace($env:BROWSER_MCP_PUBLIC_ORIGIN)) {
        return [pscustomobject]@{
            ok = $false
            skipped = $true
            reason = 'BROWSER_MCP_PUBLIC_ORIGIN is not configured.'
        } | ConvertTo-Json -Depth 4
    }

    $origin = $env:BROWSER_MCP_PUBLIC_ORIGIN.TrimEnd('/')
    $response = Invoke-WebRequest -Method Get -Uri "$origin/healthz" -SkipHttpErrorCheck -TimeoutSec 30
    $body = $null
    try {
        $body = $response.Content | ConvertFrom-Json
    } catch {
        $body = $response.Content
    }

    $bodyHasOk = $body -and $body.PSObject.Properties.Name -contains 'ok'
    $bodyHasService = $body -and $body.PSObject.Properties.Name -contains 'service'
    $expectedHealth = [bool]($bodyHasOk -and $bodyHasService -and $body.ok -eq $true -and $body.service -eq 'browser-mcp')

    return [pscustomobject]@{
        ok = [int]$response.StatusCode -eq 200 -and $expectedHealth
        status_code = [int]$response.StatusCode
        body = $body
        origin = $origin
        expected_health = $expectedHealth
    } | ConvertTo-Json -Depth 8
}

function ConvertTo-HealthCheckResult {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][bool]$Ok,
        [AllowNull()][string]$Reason = $null,
        [AllowNull()][object]$Detail = $null
    )

    [pscustomobject]@{
        name = $Name
        ok = $Ok
        state = if ($Ok) { 'READY' } else { 'DEGRADED' }
        reason = $Reason
        detail = $Detail
    }
}

function Resolve-RuntimeVerdict {
    param(
        [Parameter(Mandatory = $true)][object]$WorkerState,
        [Parameter(Mandatory = $true)][object]$McpState,
        [Parameter(Mandatory = $true)][object]$BrowserStatus,
        [Parameter(Mandatory = $true)][object]$BrowserCdpTargets,
        [Parameter(Mandatory = $true)][object]$BrowserCdpHomeVerification,
        [Parameter(Mandatory = $true)][object]$BrowserCdpCleanupPlan,
        [Parameter(Mandatory = $true)][object]$BrowserCdpCleanupBlocked,
        [Parameter(Mandatory = $true)][object]$McpSmoke,
        [Parameter(Mandatory = $true)][object]$PublicSmoke,
        [Parameter(Mandatory = $true)][object]$NamedTunnelState,
        [Parameter(Mandatory = $true)][object]$Policy
    )

    $checks = [ordered]@{}
    $checks['worker'] = ConvertTo-HealthCheckResult -Name 'worker' -Ok ([bool]($WorkerState.running -and -not $WorkerState.port_conflict)) -Reason $(if ($WorkerState.port_conflict) { 'WORKER_PORT_CONFLICT' } elseif (-not $WorkerState.running) { 'WORKER_DOWN' } else { $null }) -Detail $WorkerState
    $checks['mcp'] = ConvertTo-HealthCheckResult -Name 'mcp-server' -Ok ([bool]($McpState.running -and -not $McpState.port_conflict)) -Reason $(if ($McpState.port_conflict) { 'MCP_PORT_CONFLICT' } elseif (-not $McpState.running) { 'MCP_SERVER_DOWN' } else { $null }) -Detail $McpState
    $checks['browser'] = ConvertTo-HealthCheckResult -Name 'browser' -Ok ([bool]($BrowserStatus.ok)) -Reason $(if (-not $WorkerState.running) { 'BROWSER_SKIPPED_WORKER_DOWN' } elseif (-not $BrowserStatus.ok) { 'BROWSER_STATUS_FAILED' } else { $null }) -Detail $BrowserStatus
    $checks['browserCdpTargets'] = ConvertTo-HealthCheckResult -Name 'browser-cdp-targets' -Ok ([bool]($BrowserCdpTargets.ok)) -Reason $(if (-not $WorkerState.running) { 'BROWSER_CDP_TARGETS_SKIPPED_WORKER_DOWN' } elseif (-not $BrowserCdpTargets.ok) { 'BROWSER_CDP_TARGETS_FAILED' } else { $null }) -Detail $BrowserCdpTargets
    $checks['browserCdpHomeVerification'] = ConvertTo-HealthCheckResult -Name 'browser-cdp-home-verification' -Ok ([bool]($BrowserCdpHomeVerification.ok)) -Reason $(if (-not $WorkerState.running) { 'BROWSER_CDP_HOME_VERIFICATION_SKIPPED_WORKER_DOWN' } elseif (-not $BrowserCdpHomeVerification.ok) { 'BROWSER_CDP_HOME_VERIFICATION_FAILED' } else { $null }) -Detail $BrowserCdpHomeVerification
    $checks['browserCdpCleanupPlan'] = ConvertTo-HealthCheckResult -Name 'browser-cdp-cleanup-plan' -Ok ([bool]($BrowserCdpCleanupPlan.ok)) -Reason $(if (-not $WorkerState.running) { 'BROWSER_CDP_CLEANUP_PLAN_SKIPPED_WORKER_DOWN' } elseif (-not $BrowserCdpCleanupPlan.ok) { 'BROWSER_CDP_CLEANUP_PLAN_FAILED' } else { $null }) -Detail $BrowserCdpCleanupPlan
    $checks['browserCdpCleanupBlocked'] = ConvertTo-HealthCheckResult -Name 'browser-cdp-cleanup-blocked' -Ok ([bool]($BrowserCdpCleanupBlocked.ok)) -Reason $(if (-not $WorkerState.running) { 'BROWSER_CDP_CLEANUP_BLOCKED_SKIPPED_WORKER_DOWN' } elseif (-not $BrowserCdpCleanupBlocked.ok) { 'BROWSER_CDP_CLEANUP_BLOCKED_FAILED' } else { $null }) -Detail $BrowserCdpCleanupBlocked
    $browserBody = if ($BrowserStatus.PSObject.Properties.Name -contains 'body') { $BrowserStatus.body } else { $null }
    $browserRuntime = if ($browserBody -and $browserBody.PSObject.Properties.Name -contains 'runtime' -and $browserBody.runtime) {
        $browserBody.runtime.browser
    } else {
        [pscustomobject]@{ contextOpen = $false; pageCount = 0; currentUrl = $null }
    }
    $browserPolicy = if ($browserBody -and $browserBody.PSObject.Properties.Name -contains 'runtime' -and $browserBody.runtime -and $browserBody.runtime.PSObject.Properties.Name -contains 'policy' -and $browserBody.runtime.policy) {
        $browserBody.runtime.policy
    } else {
        [pscustomobject]@{ externalVisibleBrowser = $false; externalVisibleChrome = $false }
    }
    $browserConfiguredVisible = [bool]($browserBody -and $browserBody.configuredVisible -eq $true)
    $browserDetectedVisible = [bool]($browserBody -and ($browserBody.detectedVisibleWindow -eq $true -or $browserBody.browserVisible -eq $true))
    $sharedBrowserOwner = $null
    try {
        if (Test-Path -LiteralPath $SharedBrowserRuntimeFile) {
            $sharedBrowserOwner = Get-Content -LiteralPath $SharedBrowserRuntimeFile -Raw -Encoding UTF8 | ConvertFrom-Json
        }
    } catch {
        $sharedBrowserOwner = $null
    }
    $sharedBrowserOwnerReady = [bool]($sharedBrowserOwner -and $sharedBrowserOwner.ok -eq $true)
    $externalCdpAttached = [bool]($BrowserStatus.ok -and ($browserPolicy.externalVisibleBrowser -eq $true -or $browserPolicy.externalVisibleChrome -eq $true) -and $browserRuntime.contextOpen -eq $true -and $browserRuntime.pageCount -gt 0)
    $externalBrowserReady = [bool]($externalCdpAttached -or $sharedBrowserOwnerReady)
    $browserVisibilityOk = [bool]((-not $browserConfiguredVisible) -or $browserDetectedVisible -or $externalBrowserReady)
    $browserVisibilityReason = if (-not $browserVisibilityOk) { 'VISIBLE_BROWSER_WINDOW_NOT_DETECTED' } elseif ($externalCdpAttached -and -not $browserDetectedVisible) { 'EXTERNAL_CDP_ATTACHED_WINDOW_OWNER_NOT_DETECTED' } elseif ($sharedBrowserOwnerReady -and -not $externalCdpAttached) { 'SHARED_BROWSER_OWNER_READY_CLIENT_NOT_ATTACHED' } else { $null }
    $checks['browserVisibility'] = ConvertTo-HealthCheckResult -Name 'browser-visibility' -Ok $browserVisibilityOk -Reason $browserVisibilityReason -Detail ([pscustomobject]@{ configured_visible = $browserConfiguredVisible; detected_visible = $browserDetectedVisible; external_cdp_attached = $externalCdpAttached; shared_browser_owner_ready = $sharedBrowserOwnerReady; page_count = $browserRuntime.pageCount; current_url = $browserRuntime.currentUrl; shared_browser_owner = $sharedBrowserOwner; browser = $BrowserStatus })
    $checks['mcpSmoke'] = ConvertTo-HealthCheckResult -Name 'mcp-smoke' -Ok ([bool]($McpSmoke.ok)) -Reason $(if (-not $McpState.running) { 'MCP_SMOKE_SKIPPED_SERVER_DOWN' } elseif (-not $McpSmoke.ok) { 'MCP_SMOKE_FAILED' } else { $null }) -Detail $McpSmoke

    $publicConfigured = -not [string]::IsNullOrWhiteSpace($env:BROWSER_MCP_PUBLIC_ORIGIN)
    $checks['public'] = ConvertTo-HealthCheckResult -Name 'public' -Ok ([bool]((-not $publicConfigured) -or $PublicSmoke.ok)) -Reason $(if ($publicConfigured -and -not $PublicSmoke.ok) { 'PUBLIC_SMOKE_FAILED' } else { $null }) -Detail $PublicSmoke

    $namedTunnelRequired = -not [string]::IsNullOrWhiteSpace((Get-NamedTunnelHostname))
    $checks['namedTunnel'] = ConvertTo-HealthCheckResult -Name 'named-tunnel' -Ok ([bool]((-not $namedTunnelRequired) -or $NamedTunnelState.running)) -Reason $(if ($namedTunnelRequired -and -not $NamedTunnelState.running) { 'NAMED_TUNNEL_DOWN' } else { $null }) -Detail $NamedTunnelState
    $checks['policy'] = ConvertTo-HealthCheckResult -Name 'policy' -Ok ([bool]($Policy.warnings.Count -eq 0)) -Reason $(if ($Policy.warnings.Count -gt 0) { 'POLICY_WARNINGS' } else { $null }) -Detail $Policy

    $hardFailure = @($checks['worker'], $checks['mcp'], $checks['browser'], $checks['browserCdpTargets'], $checks['browserCdpHomeVerification'], $checks['browserCdpCleanupPlan'], $checks['browserCdpCleanupBlocked'], $checks['mcpSmoke']) | Where-Object { -not $_.ok } | Select-Object -First 1
    $softFailure = @($checks['browserVisibility'], $checks['public'], $checks['namedTunnel'], $checks['policy']) | Where-Object { -not $_.ok } | Select-Object -First 1
    $primaryFailure = if ($hardFailure) { $hardFailure } else { $softFailure }
    $recommendedAction = 'NONE'

    if ($primaryFailure) {
        switch ($primaryFailure.reason) {
            'WORKER_DOWN' { $recommendedAction = 'START_WORKER' }
            'WORKER_PORT_CONFLICT' { $recommendedAction = 'STOP_CONFLICTING_WORKER_PORT_PROCESS' }
            'MCP_SERVER_DOWN' { $recommendedAction = 'START_MCP_SERVER' }
            'MCP_PORT_CONFLICT' { $recommendedAction = 'STOP_CONFLICTING_MCP_PORT_PROCESS' }
            'BROWSER_STATUS_FAILED' { $recommendedAction = 'RESTART_WORKER' }
            'MCP_SMOKE_FAILED' { $recommendedAction = 'RESTART_MCP_SERVER' }
            'VISIBLE_BROWSER_WINDOW_NOT_DETECTED' { $recommendedAction = 'START_SHARED_BROWSER_OR_ENABLE_EXTERNAL_BROWSER' }
            'PUBLIC_SMOKE_FAILED' { $recommendedAction = 'CHECK_PUBLIC_ORIGIN_OR_TUNNEL' }
            'NAMED_TUNNEL_DOWN' { $recommendedAction = 'START_NAMED_TUNNEL' }
            default { $recommendedAction = 'INSPECT_RUNTIME' }
        }
    }

    [pscustomobject]@{
        ok = -not [bool]$primaryFailure
        state = if (-not $primaryFailure) { 'READY' } elseif ($hardFailure) { 'FAILED' } else { 'DEGRADED' }
        reason = if ($primaryFailure) { $primaryFailure.reason } else { $null }
        recommended_action = $recommendedAction
        checks = $checks
    }
}

function Get-RuntimeDoctorSnapshot {
    Ensure-Directories
    Ensure-SharedBrowserEnvironment
    $workerState = Get-WorkerState
    $mcpState = Get-McpState
    $policy = Get-PolicyState
    $browserStatus = Invoke-WorkerBrowserStatus
    $browserCdpTargets = if ($workerState.running) { Invoke-WorkerBrowserCdpTargets | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } }
    $browserCdpHomeVerification = if ($workerState.running) { Invoke-WorkerBrowserCdpHomeVerification | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } }
    $browserCdpCleanupPlan = if ($workerState.running) { Invoke-WorkerBrowserCdpCleanupPlan | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } }
    $browserCdpCleanupBlocked = if ($workerState.running) { Invoke-WorkerBrowserCdpCleanupBlocked | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } }
    $mcpSmoke = if ($mcpState.running) { Invoke-McpSmoke | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'mcp-server is not running.' } }
    $publicSmoke = if ($env:BROWSER_MCP_PUBLIC_ORIGIN) { Invoke-PublicSmoke | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'BROWSER_MCP_PUBLIC_ORIGIN is not configured.' } }
    $namedTunnelState = Get-NamedTunnelState
    $verdict = Resolve-RuntimeVerdict -WorkerState $workerState -McpState $mcpState -BrowserStatus $browserStatus -BrowserCdpTargets $browserCdpTargets -BrowserCdpHomeVerification $browserCdpHomeVerification -BrowserCdpCleanupPlan $browserCdpCleanupPlan -BrowserCdpCleanupBlocked $browserCdpCleanupBlocked -McpSmoke $mcpSmoke -PublicSmoke $publicSmoke -NamedTunnelState $namedTunnelState -Policy $policy

    [pscustomobject]@{
        ok = $verdict.ok
        state = $verdict.state
        reason = $verdict.reason
        recommended_action = $verdict.recommended_action
        timestamp = (Get-Date).ToUniversalTime().ToString('o')
        repo_root = $Root
        browser_runtime = [pscustomobject]@{
            root = $env:BROWSER_MCP_SHARED_BROWSER_ROOT
            profile = $env:BROWSER_MCP_USER_DATA_DIR
            mode = $env:BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER
            legacy_mode = $env:BROWSER_MCP_EXTERNAL_VISIBLE_CHROME
            port = $env:BROWSER_MCP_REMOTE_DEBUGGING_PORT
        }
        runtime_file = $RuntimeStateFile
        watchdog_state_file = $WatchdogStateFile
        watchdog_log_file = $WatchdogLogFile
        worker = $workerState
        mcp = $mcpState
        browser = $browserStatus
        browser_cdp_targets = $browserCdpTargets
        browser_cdp_home_verification = $browserCdpHomeVerification
        browser_cdp_cleanup_plan = $browserCdpCleanupPlan
        browser_cdp_cleanup_blocked = $browserCdpCleanupBlocked
        mcp_smoke = $mcpSmoke
        public_smoke = $publicSmoke
        named_tunnel = $namedTunnelState
        policy = $policy
        checks = $verdict.checks
    }
}

function Save-SharedBrowserRuntimeSnapshot {
    param([Parameter(Mandatory = $true)][object]$Snapshot)

    Ensure-SharedBrowserEnvironment
    $browserBody = if ($Snapshot.browser -and $Snapshot.browser.PSObject.Properties.Name -contains 'body') { $Snapshot.browser.body } else { $null }
    $browserRuntime = if ($browserBody -and $browserBody.PSObject.Properties.Name -contains 'runtime' -and $browserBody.runtime) {
        $browserBody.runtime.browser
    } else {
        [pscustomobject]@{ contextOpen = $false; pageOpen = $false; pageCount = 0; currentUrl = $null }
    }
    $browserPolicy = if ($browserBody -and $browserBody.PSObject.Properties.Name -contains 'runtime' -and $browserBody.runtime -and $browserBody.runtime.PSObject.Properties.Name -contains 'policy' -and $browserBody.runtime.policy) {
        $browserBody.runtime.policy
    } else {
        [pscustomobject]@{ externalVisibleBrowser = $false; externalVisibleChrome = $false }
    }
    $visibilityCheck = $Snapshot.checks.browserVisibility.detail
    $cdpVersion = $null
    try {
        $cdpVersion = Invoke-RestMethod -Method Get -Uri ('http://127.0.0.1:' + $env:BROWSER_MCP_REMOTE_DEBUGGING_PORT + '/json/version') -TimeoutSec 3
    } catch {
        $cdpVersion = $null
    }
    $actualUserAgent = if ($cdpVersion -and $cdpVersion.'User-Agent') { [string]$cdpVersion.'User-Agent' } else { '' }
    $actualProduct = if ($actualUserAgent -match 'Edg/') { 'msedge' } elseif ($actualUserAgent -match 'Chrome/') { 'chrome' } else { '' }
    $registry = [pscustomobject]@{
        ok = [bool]($visibilityCheck.external_cdp_attached)
        state = if ($visibilityCheck.external_cdp_attached) { 'ATTACHED' } else { 'DETACHED' }
        owner = 'browser-mcp-browser-client'
        preferred_product = 'msedge'
        fallback_product = 'chrome'
        actual_product = $actualProduct
        actual_user_agent = $actualUserAgent
        cdp_endpoint = ('http://127.0.0.1:' + $env:BROWSER_MCP_REMOTE_DEBUGGING_PORT)
        root = $env:BROWSER_MCP_SHARED_BROWSER_ROOT
        profile = $env:BROWSER_MCP_USER_DATA_DIR
        page_count = $browserRuntime.pageCount
        current_url = $browserRuntime.currentUrl
        context_open = $browserRuntime.contextOpen
        page_open = $browserRuntime.pageOpen
        visible_window_detected = $visibilityCheck.detected_visible
        external_cdp_attached = $visibilityCheck.external_cdp_attached
        updated_at = (Get-Date).ToUniversalTime().ToString('o')
    }
    $registry | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $NetworkBrowserClientRuntimeFile -Encoding utf8
}

function Save-RuntimeSnapshot {
    param([Parameter(Mandatory = $true)][object]$Snapshot)

    Ensure-Directories
    $Snapshot | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $RuntimeStateFile -Encoding utf8
    Save-SharedBrowserRuntimeSnapshot -Snapshot $Snapshot
}

function Show-RuntimeDoctor {
    $snapshot = Get-RuntimeDoctorSnapshot
    Save-RuntimeSnapshot -Snapshot $snapshot
    $json = $snapshot | ConvertTo-Json -Depth 12
    Write-Output $json
    if (-not $snapshot.ok) {
        if ($snapshot.state -eq 'FAILED') {
            exit 2
        }
        exit 1
    }
}

function Invoke-RuntimeRecover {
    Ensure-Directories
    $before = Get-RuntimeDoctorSnapshot
    $actions = @()

    switch ($before.recommended_action) {
        'START_WORKER' {
            $actions += [pscustomobject]@{ action = 'START_WORKER'; result = (Start-Worker | ConvertFrom-Json) }
        }
        'START_MCP_SERVER' {
            Start-Worker | Out-Null
            $actions += [pscustomobject]@{ action = 'START_MCP_SERVER'; result = (Start-McpServer | ConvertFrom-Json) }
        }
        'RESTART_WORKER' {
            $actions += [pscustomobject]@{ action = 'STOP_WORKER'; result = (Stop-Worker | ConvertFrom-Json) }
            $actions += [pscustomobject]@{ action = 'START_WORKER'; result = (Start-Worker | ConvertFrom-Json) }
        }
        'RESTART_MCP_SERVER' {
            $actions += [pscustomobject]@{ action = 'STOP_MCP_SERVER'; result = (Stop-McpServer | ConvertFrom-Json) }
            Start-Worker | Out-Null
            $actions += [pscustomobject]@{ action = 'START_MCP_SERVER'; result = (Start-McpServer | ConvertFrom-Json) }
        }
        'START_NAMED_TUNNEL' {
            $actions += [pscustomobject]@{ action = 'START_NAMED_TUNNEL'; result = (Start-NamedTunnel | ConvertFrom-Json) }
        }
        'START_SHARED_BROWSER_OR_ENABLE_EXTERNAL_BROWSER' {
            $actions += [pscustomobject]@{ action = 'START_SHARED_BROWSER'; result = Start-SharedBrowserOwner }
            $actions += [pscustomobject]@{ action = 'RESTART_WORKER'; result = (Stop-Worker | ConvertFrom-Json) }
            $actions += [pscustomobject]@{ action = 'START_WORKER'; result = (Start-Worker | ConvertFrom-Json) }
        }
        default {
            $actions += [pscustomobject]@{ action = 'NO_AUTOMATIC_RECOVERY'; reason = $before.reason; recommended_action = $before.recommended_action }
        }
    }

    $after = Get-RuntimeDoctorSnapshot
    Save-RuntimeSnapshot -Snapshot $after

    [pscustomobject]@{
        ok = $after.ok
        state = $after.state
        reason = $after.reason
        before = $before
        actions = $actions
        after = $after
    } | ConvertTo-Json -Depth 12
}

function Invoke-WatchTick {
    Ensure-Directories
    $before = Get-RuntimeDoctorSnapshot
    $recovery = $null
    if (-not $before.ok) {
        $recovery = Invoke-RuntimeRecover | ConvertFrom-Json
    }
    $after = Get-RuntimeDoctorSnapshot
    Save-RuntimeSnapshot -Snapshot $after

    $tick = [pscustomobject]@{
        ts = (Get-Date).ToUniversalTime().ToString('o')
        ok = $after.ok
        state = $after.state
        reason = $after.reason
        recommended_action = $after.recommended_action
        before_state = $before.state
        before_reason = $before.reason
        recovery = $recovery
    }

    ($tick | ConvertTo-Json -Depth 12 -Compress) | Add-Content -LiteralPath $WatchdogLogFile -Encoding utf8
    $tick | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $WatchdogStateFile -Encoding utf8
    return ($tick | ConvertTo-Json -Depth 12)
}

function Show-WatchStatus {
    Ensure-Directories
    $state = $null
    if (Test-Path -LiteralPath $WatchdogStateFile) {
        try {
            $state = Get-Content -LiteralPath $WatchdogStateFile -Raw | ConvertFrom-Json
        } catch {
            $state = Get-Content -LiteralPath $WatchdogStateFile -Raw
        }
    }

    [pscustomobject]@{
        ok = [bool]$state
        state_file = $WatchdogStateFile
        log_file = $WatchdogLogFile
        last_tick = $state
    } | ConvertTo-Json -Depth 12
}

function Show-Status {
    Ensure-SharedBrowserEnvironment
    $workerState = Get-WorkerState
    $mcpState = Get-McpState
    $tunnelState = Get-TunnelState
    $localSmoke = [pscustomobject]@{ ok = $false; skipped = $true; reason = 'Run dev:smoke-local explicitly for browser form smoke.' }
    $mcpSmoke = if ($mcpState.running) { Invoke-McpSmoke | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'mcp-server is not running.' } }
    $publicSmoke = if ($env:BROWSER_MCP_PUBLIC_ORIGIN) { Invoke-PublicSmoke | ConvertFrom-Json } else { [pscustomobject]@{ ok = $false; skipped = $true; reason = 'BROWSER_MCP_PUBLIC_ORIGIN is not configured.' } }
    $browserStatus = Invoke-WorkerBrowserStatus
    $policy = Get-PolicyState

    $status = [pscustomobject]@{
        repo_root = $Root
        policy = $policy
        worker = $workerState
        mcp = $mcpState
        browser = $browserStatus
        tunnel = $tunnelState
        named_tunnel = Get-NamedTunnelState
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
            mcp = $mcpSmoke
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
    $mcpState = Get-McpState
    $tunnelState = Get-TunnelState
    $mcpSmoke = if ($mcpState.running) { (Invoke-McpSmoke | ConvertFrom-Json).ok } else { $false }
    $publicSmoke = if ($env:BROWSER_MCP_PUBLIC_ORIGIN) { (Invoke-PublicSmoke | ConvertFrom-Json).ok } else { $false }
    $browserStatus = Invoke-WorkerBrowserStatus
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
        "mcp_port: $($mcpState.port)"
        "mcp_running: $($mcpState.running)"
        "tunnel_running: $($tunnelState.running)"
        "public_origin_configured: $([bool]$env:BROWSER_MCP_PUBLIC_ORIGIN)"
        "local_smoke_ok: skipped"
        "browser_visible: $(if ($browserStatus.body) { $browserStatus.body.browserVisible } else { $false })"
        "browser_detected_visible_window: $(if ($browserStatus.body) { $browserStatus.body.detectedVisibleWindow } else { $false })"
        "mcp_smoke_ok: $mcpSmoke"
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
    $cmd = Get-Command cmd.exe -ErrorAction Stop
    $launcherPath = Join-Path $Root 'tool\start-visible-worker.cmd'
    $action = New-ScheduledTaskAction -Execute $cmd.Source -Argument "/c start `"browser-mcp visible worker`" `"$launcherPath`"" -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $StartupTaskName -TaskPath $StartupTaskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Start the browser-mcp visible Playwright worker at logon.' -Force | Out-Null
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
    'runtime-doctor' { Show-RuntimeDoctor }
    'runtime-recover' { Invoke-RuntimeRecover }
    'watch-tick' { Invoke-WatchTick }
    'watch-status' { Show-WatchStatus }
    'shared-browser-status' { Get-SharedBrowserOwnerStatus | ConvertTo-Json -Depth 8 }
    'browser-cdp-targets' { Invoke-WorkerBrowserCdpTargets }
    'browser-cdp-cleanup-plan' { Invoke-WorkerBrowserCdpCleanupPlan }
    'browser-cdp-cleanup-blocked' { Invoke-WorkerBrowserCdpCleanupBlocked }
    'browser-cdp-cleanup-confirmed' { Invoke-WorkerBrowserCdpCleanupConfirmed }
    'shared-browser-start' { Start-SharedBrowserOwner | ConvertTo-Json -Depth 8 }
    'shared-browser-stop' { Stop-SharedBrowserOwner | ConvertTo-Json -Depth 8 }
    'shared-browser-restart' { Restart-SharedBrowserOwner | ConvertTo-Json -Depth 8 }
    'start' { Start-Stack }
    'start-visible-worker' { & (Join-Path $Root 'tool\start-visible-worker.cmd') }
    'restart-worker' {
        Stop-Worker | Out-Null
        Start-Worker
    }
    'stop' { Stop-Stack }
    'restart' {
        Stop-Stack | Out-Null
        Start-Stack | Out-Null
        $snapshot = Get-RuntimeDoctorSnapshot
        Save-RuntimeSnapshot -Snapshot $snapshot
        $snapshot | ConvertTo-Json -Depth 12
    }
    'start-mcp' { Start-McpServer }
    'stop-mcp' { Stop-McpServer }
    'restart-mcp' {
        Stop-McpServer | Out-Null
        Start-McpServer
    }
    'smoke-local' { Invoke-LocalSmoke }
    'smoke-public' { Invoke-PublicSmoke }
    'smoke-mcp' { Invoke-McpSmoke }
    'tail-server-log' {
        $latest = Get-ChildItem -LiteralPath $LogDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match 'playwright-worker|mcp-server|cloudflared' } |
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
    'start-named-tunnel' { Start-NamedTunnel }
    'stop-named-tunnel' { Stop-NamedTunnel }
    'named-tunnel-status' { Get-NamedTunnelState | ConvertTo-Json -Depth 8 }
    'install-named-tunnel-service' { Install-NamedTunnelService }
    'check-cloudflared' { Check-Cloudflared }
    'check-wrangler' { Check-Wrangler }
    'deploy-worker' { Deploy-Worker }
    'install-startup-task' { Install-StartupTask }
    'uninstall-startup-task' { Uninstall-StartupTask }
    'show-startup-task' { Show-StartupTask }
    'install-mcp-startup-task' { Install-McpStartupTask }
    'start-mcp-startup-task' { Start-McpStartupTask }
    'stop-mcp-startup-task' { Stop-McpStartupTask }
    'uninstall-mcp-startup-task' { Uninstall-McpStartupTask }
    'show-mcp-startup-task' { Show-McpStartupTask }
}
