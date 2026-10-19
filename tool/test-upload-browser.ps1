$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location (Join-Path $root 'playwright-worker')
try {
  & node test/upload-browser-smoke.mjs
  if($LASTEXITCODE -ne 0){ throw "Upload browser fixture failed (exit $LASTEXITCODE)" }
} finally {
  Pop-Location
}
