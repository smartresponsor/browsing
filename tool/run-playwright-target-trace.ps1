$ErrorActionPreference='Stop'
& node tool/playwright-target-trace.mjs
if($LASTEXITCODE -ne 0){throw 'TARGET_TRACE_RUN_FAILED'}
