$ErrorActionPreference = 'Stop'
& npm --prefix mcp-server ci --ignore-scripts --no-audit --no-fund --offline
if ($LASTEXITCODE -ne 0) { throw 'DEPENDENCY_INSTALL_FAILED' }
& npm --prefix playwright-worker ci --ignore-scripts --no-audit --no-fund --offline
if ($LASTEXITCODE -ne 0) { throw 'WORKER_DEPENDENCY_INSTALL_FAILED' }
& npm test
if ($LASTEXITCODE -ne 0) { throw 'REGRESSION_FAILED' }
