$ErrorActionPreference='Stop'
& node tool/cdp-attach-command-probe.mjs
if($LASTEXITCODE -ne 0){throw 'CDP_ATTACH_PROBE_FAILED'}
