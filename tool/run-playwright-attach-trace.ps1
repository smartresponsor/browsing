$ErrorActionPreference='Stop'
& node tool/playwright-attach-trace.mjs
if($LASTEXITCODE -ne 0){throw 'TRACE_RUNNER_FAILED'}
