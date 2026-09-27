function Test-LegacySmartresponsorOrigin {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    return $Value.TrimEnd('/') -eq $LegacySmartresponsorOrigin
}

function Get-WorkerPort {
    if ($env:NETWORK_MCP_WORKER_PORT) {
        return [int]$env:NETWORK_MCP_WORKER_PORT
    }

    return 8791
}

function Get-McpPort {
    if ($env:NETWORK_MCP_SERVER_PORT) {
        return [int]$env:NETWORK_MCP_SERVER_PORT
    }

    return 8792
}

function Get-NamedTunnelName {
    if ($env:NETWORK_MCP_TUNNEL_NAME) {
        return $env:NETWORK_MCP_TUNNEL_NAME.Trim()
    }

    return 'network-mcp-worker'
}

function Get-NamedTunnelHostname {
    if ($env:NETWORK_MCP_TUNNEL_HOSTNAME) {
        if (Test-LegacySmartresponsorOrigin -Value ('https://' + $env:NETWORK_MCP_TUNNEL_HOSTNAME.Trim())) {
            return ''
        }

        return $env:NETWORK_MCP_TUNNEL_HOSTNAME.Trim()
    }

    return ''
}

function Get-PublicOrigin {
    if ($env:NETWORK_MCP_PUBLIC_ORIGIN) {
        return $env:NETWORK_MCP_PUBLIC_ORIGIN.TrimEnd('/')
    }

    return $DefaultMcpPublicOrigin
}

function Get-NamedTunnelConfigPath {
    if ($env:NETWORK_MCP_TUNNEL_CONFIG) {
        return $env:NETWORK_MCP_TUNNEL_CONFIG.Trim()
    }

    $profile = $env:USERPROFILE
    if (-not $profile) {
        throw 'USERPROFILE is not available. Set NETWORK_MCP_TUNNEL_CONFIG explicitly.'
    }

    return (Join-Path $profile '.cloudflared\network-mcp-worker.yml')
}
