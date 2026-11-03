# Windows per-user DPAPI-protected HMAC authority for prepared Browsing releases.
# This never starts, stops, restarts or attaches to a browser.
[CmdletBinding()]
param(
 [Parameter(Mandatory=$true)][ValidateSet('seal','verify')][string]$Action,
 [Parameter(Mandatory=$true)][ValidatePattern('^(legacy-)?[a-fA-F0-9]{40}$')][string]$ReleaseName
)
$ErrorActionPreference='Stop'
if(-not $IsWindows){throw 'BROWSING_AUTHORITY_WINDOWS_ONLY'}
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$name=$ReleaseName.ToLowerInvariant()
$base=Join-Path $root '.releases'
$release=Join-Path $base $name
$manifestPath=Join-Path $base ($name+'.manifest.json')
if(-not (Test-Path -LiteralPath $release -PathType Container) -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)){throw 'BROWSING_RELEASE_NOT_PREPARED'}
$bytes=[IO.File]::ReadAllBytes($manifestPath)
$manifest=[Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -AsHashtable
$sha=if($name.StartsWith('legacy-')){$name.Substring(7)}else{$name}
if($manifest.source_commit -cne $sha -or $manifest.status -cne 'PREPARED_UNACTIVATED' -or
   $manifest.file_count -ne $manifest.files.Count -or
   ($name.StartsWith('legacy-') -and ($manifest.schema -ne 2 -or $manifest.type -cne 'LEGACY_ROLLBACK_ONLY')) -or
   (-not $name.StartsWith('legacy-') -and $manifest.schema -ne 1)){throw 'BROWSING_MANIFEST_IDENTITY_INVALID'}
$actualCount=0
foreach($item in @(Get-Item -LiteralPath $release)+@(Get-ChildItem -LiteralPath $release -Force -Recurse -ErrorAction Stop)){
 if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'BROWSING_RELEASE_REPARSE_DENIED'}
 if($item.PSIsContainer){continue}
 $rel=[IO.Path]::GetRelativePath($release,$item.FullName).Replace([IO.Path]::DirectorySeparatorChar,'/')
 if(-not $manifest.files.Contains($rel)){throw 'BROWSING_RELEASE_EXTRA_MEMBER'}
 $digest=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
 if($digest -cne $manifest.files[$rel]){throw 'BROWSING_RELEASE_CONTENT_DRIFT'}
 $actualCount++
}
if($actualCount -ne $manifest.file_count){throw 'BROWSING_RELEASE_MISSING_MEMBER'}
if($manifest.schema -eq 1){
 $service=Join-Path $manifest.console_release 'dist/service/visible-browser-session.js'
 if(-not (Test-Path -LiteralPath $service -PathType Leaf)){throw 'BROWSING_RELEASE_CONSOLE_MISSING'}
 if((Get-FileHash -LiteralPath $service -Algorithm SHA256).Hash.ToLowerInvariant() -cne $manifest.console_service_hash){throw 'BROWSING_RELEASE_CONSOLE_DRIFT'}
}
$rootHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Substring(0,24).ToLowerInvariant()
$authority=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ('ConsoleMcp/BrowsingReleaseAuthority/'+$rootHash)
$keyPath=Join-Path $authority 'signing-key.dpapi'
$receipt=Join-Path $authority ($name+'.signed.json')
$entropy=[Text.Encoding]::UTF8.GetBytes('BROWSING_RELEASE_V1|'+$rootHash)
if($Action -eq 'seal'){
 if(Test-Path -LiteralPath $receipt){throw 'BROWSING_RELEASE_ALREADY_SEALED'}
 $null=[IO.Directory]::CreateDirectory($authority)
 if(-not (Test-Path -LiteralPath $keyPath)){
  $newKey=[byte[]]::new(32)
  [Security.Cryptography.RandomNumberGenerator]::Fill($newKey)
  $protected=[Security.Cryptography.ProtectedData]::Protect($newKey,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  try {
   $stream=[IO.FileStream]::new($keyPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
   try{$stream.Write($protected,0,$protected.Length)}finally{$stream.Dispose()}
  } catch [IO.IOException] {
   if(-not (Test-Path -LiteralPath $keyPath)){throw}
  }
 }
}
if(-not (Test-Path -LiteralPath $keyPath)){throw 'BROWSING_AUTHORITY_KEY_MISSING'}
$key=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($keyPath),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
if($key.Length -ne 32){throw 'BROWSING_AUTHORITY_KEY_INVALID'}
$manifestHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
$signingBytes=[Text.Encoding]::UTF8.GetBytes('BROWSING_RELEASE_V1|'+$rootHash+'|'+$name+'|'+$manifestHash)
$hmac=[Security.Cryptography.HMACSHA256]::new($key)
try{$expectedMac=[Convert]::ToHexString($hmac.ComputeHash($signingBytes)).ToLowerInvariant()}finally{$hmac.Dispose();[Array]::Clear($key,0,$key.Length)}
if($Action -eq 'seal'){
 $record=@{schema=1;release_name=$name;manifest_sha256=$manifestHash;mac=$expectedMac}
 $data=[Text.Encoding]::UTF8.GetBytes(($record|ConvertTo-Json -Compress))
 $stream=[IO.FileStream]::new($receipt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($data,0,$data.Length)}finally{$stream.Dispose()}
}
if(-not (Test-Path -LiteralPath $receipt -PathType Leaf)){throw 'BROWSING_RELEASE_UNSIGNED'}
$signed=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
if($signed.schema -ne 1 -or $signed.release_name -cne $name -or $signed.manifest_sha256 -cne $manifestHash -or
  [string]$signed.mac -cnotmatch '^[0-9a-f]{64}$'){throw 'BROWSING_RELEASE_SIGNATURE_INVALID'}
if(-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals([Convert]::FromHexString($signed.mac),[Convert]::FromHexString($expectedMac))){throw 'BROWSING_RELEASE_SIGNATURE_INVALID'}
@{ok=$true;status=if($Action -eq 'seal'){'BROWSING_RELEASE_SIGNED'}else{'BROWSING_RELEASE_SIGNATURE_VALID'};release=$name;files=$actualCount;manifest_sha256=$manifestHash;runtime_mutated=$false;browser_mutated=$false}|ConvertTo-Json -Compress
