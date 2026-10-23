$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
& node (Join-Path $root 'tool/web-human-boundary-regression.mjs')
if($LASTEXITCODE -ne 0){throw ('Regression failed: '+$LASTEXITCODE)}
