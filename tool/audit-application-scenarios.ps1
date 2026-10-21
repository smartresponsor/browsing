[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$paths=@(& git -C $root ls-files --others --exclude-standard)
if($LASTEXITCODE -ne 0){throw 'Untracked inventory failed'}
$operations=[ordered]@{
 'navigation'='(?i)(goto\(|navigate|open-job|open_job|\.goto|job\.open|\.open\()'
 'dom-inspection'='(?i)(evaluate\(|querySelector|locator\(|innerText|textContent|snapshot|\.inspect|\.extract)'
 'form-input'='(?i)(\.fill\(|\.type\(|\.selectOption\(|\.check\(|fill-after-approval|fill_after_approval)'
 'file-upload'='(?i)(setInputFiles|upload-artifact|upload_artifact|filechooser|fileChooser)'
 'final-submit'='(?i)(submit-after-approval|submit_after_approval|\.submit\(|submit application|final.submit|click\([^\r\n]*submit)'
 'session-auth'='(?i)(sign.?in|login|captcha|cookie|auth|session)'
 'date-widget'='(?i)(dateSection|date[-_]?segment|month[-_]?input|year[-_]?input)'
 'recovery'='(?i)(retry|recover|timeout|restart|connectOverCDP|websocket|cdp)'
}
$candidates=@($paths | Where-Object {$_ -match '^(playwright-worker/[^/]+\.mjs|tool/[^/]+\.(ps1|mjs))$' -and $_ -notmatch '(?i)(\.env|credential|secret|token|private|\.pem$|\.key$|cookie|session)'})
$stats=@{}
foreach($op in $operations.Keys){$stats[$op]=0}
$hosts=@{}
$inspect=@()
foreach($path in $candidates){
 $full=Join-Path $root ($path -replace '/','\')
 if(-not(Test-Path -LiteralPath $full -PathType Leaf)){continue}
 $info=Get-Item -LiteralPath $full
 if($info.Length -gt 262144){continue}
 $content=[IO.File]::ReadAllText($full)
 $matched=@()
 foreach($op in $operations.Keys){
  if($content -match $operations[$op]){$stats[$op]++;$matched+= $op}
 }
 $stem=[IO.Path]::GetFileNameWithoutExtension($path)
 $prefix=($stem -split '-')[0].ToLowerInvariant()
 if(-not $hosts.ContainsKey($prefix)){$hosts[$prefix]=0}
 $hosts[$prefix]++
 if($matched.Count -ge 3){$inspect+=@{file=$path;operations=$matched;bytes=$info.Length}}
}
$summary=@($stats.GetEnumerator()|Sort-Object Name|ForEach-Object{@{operation=$_.Key;files=$_.Value}})
$families=@($hosts.GetEnumerator()|Sort-Object Value -Descending|Select-Object -First 16|ForEach-Object{@{family=$_.Key;files=$_.Value}})
$complex=@($inspect|Sort-Object {$_.operations.Count} -Descending|Select-Object -First 20)
@{
 ok=$true;mode='READ_ONLY';scanned=$candidates.Count;operationCounts=$summary;topFamilies=$families;
 multiOperationCount=$inspect.Count;
 examples=$complex;
 architecture='Extract reusable capabilities into worker and regression suite; do not register job-specific scripts as MCP tools.'
} | ConvertTo-Json -Depth 7

