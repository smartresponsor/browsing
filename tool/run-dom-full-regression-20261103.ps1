$ErrorActionPreference = 'Stop'
& npm test
if ($LASTEXITCODE -ne 0) { throw 'REGRESSION_FAILED' }
