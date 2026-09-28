function Convert-StackComponentResult {
    param(
        [Parameter(ValueFromPipeline = $true)]
        $Value
    )

    process {
        if ($null -eq $Value) {
            return $null
        }

        if ($Value -is [string]) {
            return ($Value | ConvertFrom-Json)
        }

        return $Value
    }
}

function Start-Stack {
    $sharedBrowser = Start-SharedBrowserOwner
    $worker = Start-Worker | Convert-StackComponentResult
    $mcp = Start-McpServer | Convert-StackComponentResult
    $legacyTunnel = Stop-Tunnel | Convert-StackComponentResult
    $namedTunnel = Start-NamedTunnel | Convert-StackComponentResult
    [pscustomobject]@{
        ok = $true
        shared_browser = $sharedBrowser
        worker = $worker
        mcp = $mcp
        legacy_quick_tunnel = $legacyTunnel
        named_tunnel = $namedTunnel
    } | ConvertTo-Json -Depth 8
}

function Stop-Stack {
    $legacyTunnel = Stop-Tunnel | Convert-StackComponentResult
    $namedTunnel = Stop-NamedTunnel | Convert-StackComponentResult
    $mcp = Stop-McpServer | Convert-StackComponentResult
    $worker = Stop-Worker | Convert-StackComponentResult
    [pscustomobject]@{
        ok = $true
        worker = $worker
        mcp = $mcp
        legacy_quick_tunnel = $legacyTunnel
        named_tunnel = $namedTunnel
    } | ConvertTo-Json -Depth 8
}
