$ErrorActionPreference = 'Stop'
& node --check playwright-worker/src/worker.js
if ($LASTEXITCODE -ne 0) { throw 'NODE_SYNTAX_FAILED' }
& node --test tool/web-frame-path-regression.mjs tool/web-dom-capture-batches-regression.mjs
if ($LASTEXITCODE -ne 0) { throw 'FRAME_REGRESSION_FAILED' }
