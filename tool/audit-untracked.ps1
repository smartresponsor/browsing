[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$paths = @(& git -C $root ls-files --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw 'git ls-files failed' }
$groups = $paths | Group-Object { ($_ -split '/')[0] } | Sort-Object Count -Descending |
  ForEach-Object { [pscustomobject]@{ directory = $_.Name; count = $_.Count } }
$suspicious = @($paths | Where-Object { $_ -match '(?i)(\.env|credential|secret|token|private|\.pem$|\.key$|cookie|session)' })
$candidates = @($paths | Where-Object {
  $_ -notmatch '^playwright-worker/' -and
  $_ -notmatch '(?i)(\.env|credential|secret|token|private|\.pem$|\.key$|cookie|session)'
})
$result = [ordered]@{
  ok = $true
  total = $paths.Count
  groups = @($groups)
  sensitive_name_count = $suspicious.Count
  candidate_count = $candidates.Count
  candidates = @($candidates | Select-Object -First 150)
  operator_action = 'Read-only inventory: never bulk-stage or commit candidate files without review'
}
$result | ConvertTo-Json -Depth 6
