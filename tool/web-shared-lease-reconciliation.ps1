param([Parameter(Mandatory=$true)][string]$ConsoleRoot)
$ErrorActionPreference = 'Stop'
$env:BROWSER_MCP_CONSOLE_ROOT = $ConsoleRoot
& node --check playwright-worker/src/worker.js
if ($LASTEXITCODE -ne 0) { throw 'WORKER_SYNTAX_FAILED' }
foreach ($test in @('tool/web-worker-drain-regression.mjs','tool/web-targeted-capture-isolation-regression.mjs','tool/web-visible-session-regression.mjs','playwright-worker/src/failure-envelope.test.js','playwright-worker/test/fill-rate-limiter.test.js')) {
    & node $test
    if ($LASTEXITCODE -ne 0) { throw "REGRESSION_FAILED $test" }
}
& node tool/web-shared-lease-drain-regression.mjs $ConsoleRoot
if ($LASTEXITCODE -ne 0) { throw 'SHARED_LEASE_DRAIN_FAILED' }
Write-Output 'BROWSING_UPSTREAM_RECONCILIATION_PASS'
