$ErrorActionPreference = 'Stop'
& node tool/dom-capture-headless-smoke.mjs
if ($LASTEXITCODE -ne 0) { throw 'HEADLESS_SMOKE_FAILED' }
