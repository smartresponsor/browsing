# Verify an already prepared Browsing release without writing any bytes.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedCommit)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sha=$ExpectedCommit.ToLowerInvariant()
$base=Join-Path $root '.releases'
$release=Join-Path $base $sha
$manifestPath=Join-Path $base ($sha+'.manifest.json')
if(-not (Test-Path -LiteralPath $release -PathType Container) -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)){throw 'RELEASE_NOT_PREPARED'}
$manifest=Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json -AsHashtable
if($manifest.schema -ne 1 -or $manifest.source_commit -cne $sha -or $manifest.status -cne 'PREPARED_UNACTIVATED'){throw 'RELEASE_MANIFEST_INVALID'}
$expected=$manifest.files
if(-not $expected -or $manifest.file_count -ne $expected.Count){throw 'RELEASE_MANIFEST_COUNT_MISMATCH'}
$observed=0
foreach($item in @(Get-Item -LiteralPath $release)+@(Get-ChildItem -LiteralPath $release -Force -Recurse -ErrorAction Stop)){
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'RELEASE_REPARSE_MEMBER_DENIED'}
 if($item.PSIsContainer){continue}
 $rel=[IO.Path]::GetRelativePath($release,$item.FullName).Replace([IO.Path]::DirectorySeparatorChar,'/')
 if(-not $expected.Contains($rel)){throw 'RELEASE_EXTRA_MEMBER'}
 $actual=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
 if($actual -cne $expected[$rel]){throw 'RELEASE_CONTENT_DRIFT'}
 $observed++
}
if($observed -ne $manifest.file_count){throw 'RELEASE_MISSING_MEMBER'}
$service=Join-Path $manifest.console_release 'dist/service/visible-browser-session.js'
if(-not (Test-Path -LiteralPath $service -PathType Leaf)){throw 'RELEASE_CONSOLE_DEPENDENCY_MISSING'}
if((Get-FileHash -LiteralPath $service -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.console_service_hash){throw 'RELEASE_CONSOLE_DEPENDENCY_DRIFT'}
@{ok=$true;status='BROWSING_RELEASE_CONTENT_VERIFIED';sha=$sha;release=$release;file_count=$observed;console_release=$manifest.console_release;runtime_mutated=$false}|ConvertTo-Json -Compress
