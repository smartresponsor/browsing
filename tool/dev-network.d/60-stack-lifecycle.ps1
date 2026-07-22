function Start-Stack {
    $sharedBrowser = Start-SharedBrowserOwner
    $worker = Start-Worker
    $mcp = Start-McpServer
    $legacyTunnel = Stop-Tunnel | ConvertFrom-Json
    $namedTunnel = Start-NamedTunnel | ConvertFrom-Json
    [pscustomobject]@{
        ok = $true
        shared_browser = $sharedBrowser
        worker = $worker | ConvertFrom-Json
        mcp = $mcp | ConvertFrom-Json
        legacy_quick_tunnel = $legacyTunnel
        named_tunnel = $namedTunnel
    } | ConvertTo-Json -Depth 8
}

function Stop-Stack {
    $legacyTunnel = Stop-Tunnel | ConvertFrom-Json
    $namedTunnel = Stop-NamedTunnel | ConvertFrom-Json
    $mcp = Stop-McpServer | ConvertFrom-Json
    $worker = Stop-Worker | ConvertFrom-Json
    [pscustomobject]@{
        ok = $true
        worker = $worker
        mcp = $mcp
        legacy_quick_tunnel = $legacyTunnel
        named_tunnel = $namedTunnel
    } | ConvertTo-Json -Depth 8
}
