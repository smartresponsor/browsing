# Build a self-contained Browsing release without touching any live processes.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedCommit,
      [Parameter(Mandatory=$true)][string]$ConsoleReleaseRoot,
      [switch]$AllowHistoricalMaster)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$console=(Resolve-Path -LiteralPath $ConsoleReleaseRoot).Path
$service=Join-Path $console 'dist/service/visible-browser-session.js'
if(-not (Test-Path -LiteralPath $service -PathType Leaf)){throw 'RELEASE_CONSOLE_SERVICE_MISSING'}
$serviceHash=(Get-FileHash -LiteralPath $service -Algorithm SHA256).Hash.ToLowerInvariant()
$commit=(& git -C $root rev-parse --verify 'origin/master^{commit}' | Out-String).Trim().ToLowerInvariant()
if($LASTEXITCODE -ne 0){throw 'RELEASE_MASTER_UNAVAILABLE'}
if($commit -cne $ExpectedCommit.ToLowerInvariant()){
 if(-not $AllowHistoricalMaster){throw 'RELEASE_MASTER_SHA_MISMATCH'}
 & git -C $root merge-base --is-ancestor $ExpectedCommit origin/master
 if($LASTEXITCODE -ne 0){throw 'RELEASE_NOT_MASTER_ANCESTOR'}
 $commit=$ExpectedCommit.ToLowerInvariant()
}
$releases=Join-Path $root '.releases'
$dest=Join-Path $releases $commit
if(Test-Path -LiteralPath $dest){throw 'RELEASE_ALREADY_EXISTS_NO_MUTATION'}
$null=[IO.Directory]::CreateDirectory($releases)
$stage=Join-Path $releases ('.preparing-'+[guid]::NewGuid().ToString('N'))
$null=[IO.Directory]::CreateDirectory($stage)
$archive=Join-Path $stage 'source.zip'
try {
 & git -C $root archive --format=zip --output=$archive $commit
 if($LASTEXITCODE -ne 0){throw 'RELEASE_ARCHIVE_FAILED'}
 $unpacked=Join-Path $stage 'content'
 $null=[IO.Directory]::CreateDirectory($unpacked)
 Expand-Archive -LiteralPath $archive -DestinationPath $unpacked -Force
 foreach($part in @('mcp-server','playwright-worker')){
  $pkg=Join-Path $unpacked $part
  if(-not (Test-Path -LiteralPath (Join-Path $pkg 'package-lock.json'))){throw 'RELEASE_LOCKFILE_MISSING'}
  & npm --prefix $pkg ci --no-audit --no-fund
  if($LASTEXITCODE -ne 0){throw 'RELEASE_DEPENDENCIES_FAILED'}
 }
 $oldConsoleRoot=$env:BROWSER_MCP_CONSOLE_ROOT
 $env:BROWSER_MCP_CONSOLE_ROOT=$console
 try {
  & npm --prefix $unpacked test
  if($LASTEXITCODE -ne 0){throw 'RELEASE_REGRESSION_FAILED'}
  & npm --prefix $unpacked run typecheck
  if($LASTEXITCODE -ne 0){throw 'RELEASE_TYPECHECK_FAILED'}
 } finally {
  if($null -eq $oldConsoleRoot){Remove-Item Env:BROWSER_MCP_CONSOLE_ROOT -ErrorAction SilentlyContinue}
  else {$env:BROWSER_MCP_CONSOLE_ROOT=$oldConsoleRoot}
 }
 $files=[ordered]@{}
 foreach($item in @(Get-ChildItem -LiteralPath $unpacked -Force -Recurse -ErrorAction Stop)){
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'RELEASE_REPARSE_MEMBER_DENIED'}
  if(-not $item.PSIsContainer){
   $rel=[IO.Path]::GetRelativePath($unpacked,$item.FullName).Replace([IO.Path]::DirectorySeparatorChar,'/')
   $files[$rel]=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
 }
 if(-not $files.Contains('playwright-worker/src/worker.js')){throw 'RELEASE_WORKER_ENTRY_MISSING'}
 $manifest=@{schema=1;source_commit=$commit;console_release=$console;console_service_hash=$serviceHash;file_count=$files.Count;files=$files;status='PREPARED_UNACTIVATED'}
 $manifestPath=Join-Path $stage 'manifest.json'
 $manifest | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath $manifestPath -Encoding utf8
 Move-Item -LiteralPath $unpacked -Destination $dest -ErrorAction Stop
 Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $releases ($commit+'.manifest.json')) -ErrorAction Stop
 @{ok=$true;status='BROWSING_RELEASE_PREPARED';sha=$commit;release=$dest;file_count=$files.Count;runtime_mutated=$false;browser_mutated=$false;manifest=(Join-Path $releases ($commit+'.manifest.json'))}|ConvertTo-Json -Compress
} finally {
 # Retain only failed staging area for forensic recovery. Never alter a completed release.
 if((Test-Path -LiteralPath $dest) -and (Test-Path -LiteralPath $stage)){Remove-Item -LiteralPath $stage -Force -Recurse}
}
