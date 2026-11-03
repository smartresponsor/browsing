$ErrorActionPreference='Stop'
$root=Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $root
try {
 & /usr/bin/node --check playwright-worker/src/worker.js
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
 & /usr/bin/node --test playwright-worker/test/fill-rate-limiter.test.js
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
 & /usr/bin/npm test
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
}finally{Pop-Location}
