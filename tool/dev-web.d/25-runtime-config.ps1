function Test-LegacySmartresponsorOrigin {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    return $Value.TrimEnd('/') -eq $LegacySmartresponsorOrigin
}

function Get-WorkerPort {
    if ($env:BROWSER_MCP_WORKER_PORT) {
        return [int]$env:BROWSER_MCP_WORKER_PORT
    }

    return 8791
}

function Get-McpPort {
    if ($env:BROWSER_MCP_SERVER_PORT) {
        return [int]$env:BROWSER_MCP_SERVER_PORT
    }

    return 8792
}

function Get-NamedTunnelName {
    if ($env:BROWSER_MCP_TUNNEL_NAME) {
        return $env:BROWSER_MCP_TUNNEL_NAME.Trim()
    }

    return 'browser-mcp-worker'
}

function Get-NamedTunnelHostname {
    if ($env:BROWSER_MCP_TUNNEL_HOSTNAME) {
        if (Test-LegacySmartresponsorOrigin -Value ('https://' + $env:BROWSER_MCP_TUNNEL_HOSTNAME.Trim())) {
            return ''
        }

        return $env:BROWSER_MCP_TUNNEL_HOSTNAME.Trim()
    }

    return ''
}

function Get-PublicOrigin {
    if ($env:BROWSER_MCP_PUBLIC_ORIGIN) {
        return $env:BROWSER_MCP_PUBLIC_ORIGIN.TrimEnd('/')
    }

    return $DefaultMcpPublicOrigin
}

function Get-NamedTunnelConfigPath {
    if ($env:BROWSER_MCP_TUNNEL_CONFIG) {
        return $env:BROWSER_MCP_TUNNEL_CONFIG.Trim()
    }

    $profile = $env:USERPROFILE
    if (-not $profile) {
        throw 'USERPROFILE is not available. Set BROWSER_MCP_TUNNEL_CONFIG explicitly.'
    }

    return (Join-Path $profile '.cloudflared\browser-mcp-worker.yml')
}
