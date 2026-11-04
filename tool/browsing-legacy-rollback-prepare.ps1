# Preserve legacy Browser worker bytes in the historical sibling layout required by its imports.
# No runtime/Edge mutation. A rollback artifact is not activation authorization.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedCommit,
 [Parameter(Mandatory=$true)][string]$ConsoleReleaseRoot
)
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'WINDOWS_LEGACY_ROLLBACK_ONLY'}
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sha=$ExpectedCommit.ToLowerInvariant()
& git -C $root merge-base --is-ancestor $sha origin/master
if($LASTEXITCODE -ne 0){throw 'ROLLBACK_SHA_NOT_MASTER_ANCESTOR'}
$console=(Resolve-Path -LiteralPath $ConsoleReleaseRoot).Path
$consoleDist=Join-Path $console 'dist'
if(-not (Test-Path -LiteralPath (Join-Path $consoleDist 'service/visible-browser-session.js') -PathType Leaf)){throw 'ROLLBACK_CONSOLE_DEPENDENCY_MISSING'}
$base=Join-Path $root '.releases'
$dest=Join-Path $base ('legacy-'+$sha)
if(Test-Path -LiteralPath $dest){throw 'ROLLBACK_RELEASE_ALREADY_EXISTS'}
$null=[IO.Directory]::CreateDirectory($base)
$stage=Join-Path $base ('.legacy-preparing-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($stage)
$archive=Join-Path $stage 'source.zip'
$bundle=Join-Path $stage 'bundle'
$legacy=Join-Path $bundle 'Browsing'
$compat=Join-Path $bundle 'console-mcp'
$null=[IO.Directory]::CreateDirectory($legacy)
$null=[IO.Directory]::CreateDirectory($compat)
try {
 & git -C $root archive --format=zip --output=$archive $sha
 if($LASTEXITCODE -ne 0){throw 'ROLLBACK_SOURCE_ARCHIVE_FAILED'}
 Expand-Archive -LiteralPath $archive -DestinationPath $legacy -Force
 Copy-Item -LiteralPath $consoleDist -Destination (Join-Path $compat 'dist') -Recurse -Force
 foreach($part in @('mcp-server','playwright-worker')){
  $pkg=Join-Path $legacy $part
  & npm --prefix $pkg ci --no-audit --no-fund
  if($LASTEXITCODE -ne 0){throw 'ROLLBACK_DEPENDENCIES_FAILED'}
 }
 $previous=$env:BROWSER_MCP_CONSOLE_ROOT
 Remove-Item Env:BROWSER_MCP_CONSOLE_ROOT -ErrorAction SilentlyContinue
 try {
  & npm --prefix $legacy test
  if($LASTEXITCODE -ne 0){throw 'ROLLBACK_REGRESSION_FAILED'}
  & npm --prefix $legacy run typecheck
  if($LASTEXITCODE -ne 0){throw 'ROLLBACK_TYPECHECK_FAILED'}
 } finally {
  if($null -ne $previous){$env:BROWSER_MCP_CONSOLE_ROOT=$previous}
 }
 $files=[ordered]@{}
 foreach($item in @(Get-Item $bundle)+@(Get-ChildItem -LiteralPath $bundle -Recurse -Force -ErrorAction Stop)){
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'ROLLBACK_REPARSE_MEMBER_DENIED'}
  if(-not $item.PSIsContainer){
   $rel=[IO.Path]::GetRelativePath($bundle,$item.FullName).Replace([IO.Path]::DirectorySeparatorChar,'/')
   $files[$rel]=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
 }
 $manifest=@{schema=2;source_commit=$sha;type='LEGACY_ROLLBACK_ONLY';entry='Browsing/playwright-worker/src/worker.js';file_count=$files.Count;files=$files;status='PREPARED_UNACTIVATED'}
 $manifestPath=Join-Path $stage 'manifest.json'
 $manifest | ConvertTo-Json -Depth 6 -Compress | Set-Content -LiteralPath $manifestPath -Encoding utf8
 Move-Item -LiteralPath $bundle -Destination $dest -ErrorAction Stop
 Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $base ('legacy-'+$sha+'.manifest.json')) -ErrorAction Stop
 @{ok=$true;status='BROWSING_LEGACY_ROLLBACK_PREPARED';release=$dest;sha=$sha;file_count=$files.Count;runtime_mutated=$false;browser_mutated=$false}|ConvertTo-Json -Compress
} finally {
 if(Test-Path -LiteralPath $dest){Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
}
