# Read-only admission for replacing only the externally attached Playwright worker.
[CmdletBinding()]
param(
 [ValidatePattern('^[a-fA-F0-9]{40}$')][string]$CandidateSha='ca54979e386fc6b73cb9e1dfedad6bbb481bde4e',
 [ValidatePattern('^[a-fA-F0-9]{40}$')][string]$RollbackSha='456e5bcb3fab7e6798e7fe7848dfd5b28845b76b'
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$auth=Join-Path $PSScriptRoot 'browsing-release-authority.ps1'
$checks=[Collections.Generic.List[object]]::new()
function Add-Check([string]$Name,[bool]$Ok,$Evidence){$script:checks.Add(@{name=$Name;passed=$Ok;detail=$Evidence})}
foreach($item in @(@{kind='candidate';name=$CandidateSha},@{kind='rollback';name=('legacy-'+$RollbackSha)})){
 try {
  $res=& $auth -Action verify -ReleaseName $item.name | ConvertFrom-Json
  Add-Check ('sealed-'+$item.kind) ([bool]$res.ok -and $res.status -ceq 'BROWSING_RELEASE_SIGNATURE_VALID') @{files=$res.files;manifest=$res.manifest_sha256}
 }catch{Add-Check ('sealed-'+$item.kind) $false @{reason='SEAL_VERIFICATION_FAILED'}}
}
try {
 $pidFile=Join-Path $root 'var/run/playwright-worker.pid'
 $pidValue=[int](Get-Content -LiteralPath $pidFile -Raw)
 $listeners=@(Get-NetTCPConnection -State Listen -LocalPort 8791 -ErrorAction Stop)
 if($listeners.Count -ne 1){throw 'LISTENER_AMBIGUOUS'}
 $ownerPid=[int]$listeners[0].OwningProcess
 $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ownerPid)
 if(-not $process -or $ownerPid -ne $pidValue){throw 'WORKER_PID_OR_LISTENER_DRIFT'}
 $owner=Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $expectedEntry=[IO.Path]::GetFullPath((Join-Path $root 'playwright-worker/src/worker.js'))
 $expectedCommand=('"'+[IO.Path]::GetFullPath($process.ExecutablePath)+'" --enable-source-maps '+$expectedEntry)
 $entryPresent=([string]$process.CommandLine).Equals($expectedCommand,[StringComparison]::OrdinalIgnoreCase)
 $identity=($owner.ReturnValue -eq 0 -and $owner.Sid -ceq $sid -and $entryPresent -and
            $process.SessionId -eq [Diagnostics.Process]::GetCurrentProcess().SessionId)
 Add-Check 'incumbent-worker-process' $identity @{pid=$ownerPid;entrypoint_matches=$entryPresent;session_matches=($process.SessionId -eq [Diagnostics.Process]::GetCurrentProcess().SessionId)}
}catch{Add-Check 'incumbent-worker-process' $false @{reason='WORKER_IDENTITY_UNVERIFIED'}}
try {
 $state=Invoke-RestMethod -Uri 'http://127.0.0.1:8791/healthz' -NoProxy -TimeoutSec 5
 Add-Check 'worker-external-attachment' ([bool]$state.ok -and $state.browserMode -ceq 'external-browser-cdp') @{mode=$state.browserMode;healthy=$state.ok}
}catch{Add-Check 'worker-external-attachment' $false @{reason='WORKER_HEALTH_UNAVAILABLE'}}
try {
 $edge=@(Get-NetTCPConnection -State Listen -LocalPort 9223 -ErrorAction Stop)
 $target=Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/version' -NoProxy -TimeoutSec 5
 $independent=($edge.Count -eq 1 -and [int]$edge[0].OwningProcess -gt 0 -and
               [int]$edge[0].OwningProcess -ne $ownerPid -and $target.webSocketDebuggerUrl)
 Add-Check 'edge-independent-cdp' ([bool]$independent) @{browser_pid=if($edge.Count -eq 1){$edge[0].OwningProcess}else{$null};connected=[bool]$target.webSocketDebuggerUrl}
}catch{Add-Check 'edge-independent-cdp' $false @{reason='EDGE_CDP_UNAVAILABLE'}}
# Existing worker health does not expose authoritative in-flight operation count
# or an exclusive drain/lease acknowledgment. Do not infer quiescence from pageCount=0.
Add-Check 'worker-exclusive-drain' $false @{reason='IN_FLIGHT_OPERATION_COUNT_UNOBSERVABLE'}
$ready=(@($checks|Where-Object {-not $_.passed}).Count -eq 0)
@{ok=$true;status=if($ready){'BROWSING_WORKER_CUTOVER_ADMITTED'}else{'BROWSING_WORKER_CUTOVER_BLOCKED'};activationReady=$ready;checks=$checks.ToArray();runtime_mutated=$false;browser_mutated=$false}|ConvertTo-Json -Depth 7
