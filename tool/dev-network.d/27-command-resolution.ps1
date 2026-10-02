function Resolve-CloudflaredExe {
    $candidates = @()

    if ($env:BROWSER_MCP_CLOUDFLARED_BIN) {
        $candidates += $env:BROWSER_MCP_CLOUDFLARED_BIN.Trim()
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

    throw 'cloudflared.exe was not found. Set BROWSER_MCP_CLOUDFLARED_BIN, install it at C:\Tools\cloudflared\cloudflared.exe, or add it to PATH.'
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
