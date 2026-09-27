$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$mcpRoot = Join-Path $root 'mcp-server'
$runDir = Join-Path $root 'var\run'
$logDir = Join-Path $root 'var\log'
$pidFile = Join-Path $runDir 'mcp-server.pid'
$logFile = Join-Path $logDir 'mcp-server.log'
$errFile = Join-Path $logDir 'mcp-server.err.log'
$mcpWorkspaceRoot = Split-Path -Parent $root
$sharedSecretRuntime = Join-Path $mcpWorkspaceRoot 'AwsSecretContract\tool\secret-runtime.ps1'

if (Test-Path -LiteralPath $sharedSecretRuntime -PathType Leaf) {
    . $sharedSecretRuntime -Command export-env -Consumer network-mcp -IncludePrevious
}

New-Item -ItemType Directory -Path $runDir -Force | Out-Null
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$port = if ($env:NETWORK_MCP_SERVER_PORT) { [int]$env:NETWORK_MCP_SERVER_PORT } else { 8792 }
$env:NETWORK_MCP_SERVER_PORT = [string]$port
$mcpScript = Join-Path $mcpRoot 'src\server.js'
$node = Get-Command node.exe -ErrorAction Stop

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    throw "Persistent Network MCP launcher refused to start because port $port is already listening (PID $($listener.OwningProcess))."
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
Set-Content -LiteralPath $logFile -Value '' -Encoding utf8
Set-Content -LiteralPath $errFile -Value '' -Encoding utf8

$process = $null
try {
    $process = Start-Process `
        -FilePath $node.Source `
        -ArgumentList @('--enable-source-maps', $mcpScript) `
        -WorkingDirectory $mcpRoot `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError $errFile

    Set-Content -LiteralPath $pidFile -Value $process.Id -NoNewline
    $process.WaitForExit()
    exit $process.ExitCode
} finally {
    if ($process -and (Test-Path -LiteralPath $pidFile)) {
        $currentPid = (Get-Content -LiteralPath $pidFile -Raw).Trim()
        if ($currentPid -eq [string]$process.Id) {
            Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        }
    }
}
