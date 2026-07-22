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

function Invoke-WorkerBrowserStatus {
    $state = Get-WorkerState
    if (-not $state.running) {
        return [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' }
    }

    $response = Invoke-WorkerRequest -Path '/browser-status' -Body '{}'
    $body = $null
    try {
        $body = $response.content | ConvertFrom-Json
    } catch {
        $body = $response.content
    }

    return [pscustomobject]@{ ok = $response.status_code -eq 200; status_code = $response.status_code; body = $body }
}

function Invoke-WorkerBrowserCdpTargets {
    $state = Get-WorkerState
    if (-not $state.running) {
        return [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } | ConvertTo-Json -Depth 8
    }

    $response = Invoke-WorkerRequest -Path '/browser-cdp-targets' -Body '{}'
    $body = $null
    try {
        $body = $response.content | ConvertFrom-Json
    } catch {
        $body = $response.content
    }

    return [pscustomobject]@{
        ok = $response.status_code -eq 200 -and $body.ok -eq $true
        status_code = $response.status_code
        body = $body
    } | ConvertTo-Json -Depth 12
}

function Invoke-WorkerBrowserCdpHomeVerification {
    $state = Get-WorkerState
    if (-not $state.running) {
        return [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } | ConvertTo-Json -Depth 8
    }

    $bodyJson = @{ maxVerify = 1; timeoutMs = 5000 } | ConvertTo-Json -Depth 4
    $response = Invoke-WorkerRequest -Path '/browser-cdp-verify-chatgpt-home' -Body $bodyJson
    $body = $null
    try {
        $body = $response.content | ConvertFrom-Json
    } catch {
        $body = $response.content
    }

    return [pscustomobject]@{
        ok = $response.status_code -eq 200 -and $body.ok -eq $true
        status_code = $response.status_code
        body = $body
    } | ConvertTo-Json -Depth 12
}

function Invoke-WorkerBrowserCdpCleanupPlan {
    $state = Get-WorkerState
    if (-not $state.running) {
        return [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } | ConvertTo-Json -Depth 8
    }

    $bodyJson = @{ maxVerify = 1; maxClose = 1; timeoutMs = 5000 } | ConvertTo-Json -Depth 4
    $response = Invoke-WorkerRequest -Path '/browser-cdp-cleanup-plan-chatgpt-home' -Body $bodyJson
    $body = $null
    try {
        $body = $response.content | ConvertFrom-Json
    } catch {
        $body = $response.content
    }

    return [pscustomobject]@{
        ok = $response.status_code -eq 200 -and $body.ok -eq $true -and $body.mode -eq 'dry-run'
        status_code = $response.status_code
        body = $body
    } | ConvertTo-Json -Depth 12
}

function Invoke-WorkerBrowserCdpCleanupBlocked {
    $state = Get-WorkerState
    if (-not $state.running) {
        return [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } | ConvertTo-Json -Depth 8
    }

    $bodyJson = @{ confirmCleanup = $false; maxVerify = 1; maxClose = 1; timeoutMs = 5000 } | ConvertTo-Json -Depth 4
    $response = Invoke-WorkerRequest -Path '/browser-cdp-cleanup-chatgpt-home' -Body $bodyJson
    $body = $null
    try {
        $body = $response.content | ConvertFrom-Json
    } catch {
        $body = $response.content
    }

    return [pscustomobject]@{
        ok = $response.status_code -eq 200 -and $body.ok -eq $false -and $body.status -eq 'CONFIRM_CLEANUP_REQUIRED'
        status_code = $response.status_code
        body = $body
    } | ConvertTo-Json -Depth 12
}

function Invoke-WorkerBrowserCdpCleanupConfirmed {
    $state = Get-WorkerState
    if (-not $state.running) {
        return [pscustomobject]@{ ok = $false; skipped = $true; reason = 'playwright-worker is not running.' } | ConvertTo-Json -Depth 8
    }

    $bodyJson = @{ confirmCleanup = $true; maxVerify = 50; maxClose = 10; timeoutMs = 5000 } | ConvertTo-Json -Depth 4
    $response = Invoke-WorkerRequest -Path '/browser-cdp-cleanup-chatgpt-home' -Body $bodyJson
    $body = $null
    try {
        $body = $response.content | ConvertFrom-Json
    } catch {
        $body = $response.content
    }

    return [pscustomobject]@{
        ok = $response.status_code -eq 200 -and $body.ok -eq $true -and $body.guard.conversationCountPreserved -eq $true
        status_code = $response.status_code
        body = $body
    } | ConvertTo-Json -Depth 12
}
