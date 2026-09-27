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

    $maxSessionSeconds = if ($env:NETWORK_MCP_MAX_SESSION_SECONDS) { [int]$env:NETWORK_MCP_MAX_SESSION_SECONDS } else { 7200 }
    $maxPageVisits = if ($env:NETWORK_MCP_MAX_PAGE_VISITS) { [int]$env:NETWORK_MCP_MAX_PAGE_VISITS } else { 100 }
    $maxFormFills = if ($env:NETWORK_MCP_MAX_FORM_FILLS) { [int]$env:NETWORK_MCP_MAX_FORM_FILLS } else { 20 }
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
