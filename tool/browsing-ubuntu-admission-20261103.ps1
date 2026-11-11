# Ubuntu read-only fail-closed admission. Does not modify running processes.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$CandidateSha)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$checks=[Collections.Generic.List[object]]::new()
function Check([string]$Name,[bool]$Passed,[string]$Detail){$script:checks.Add(@{name=$Name;passed=$Passed;detail=$Detail})}
Check 'ubuntu-platform' ($IsLinux -and (Test-Path '/proc/self/status')) 'Linux procfs required'
$head=(& git -C $root rev-parse HEAD | Out-String).Trim().ToLowerInvariant()
Check 'candidate-head' ($head -ceq $CandidateSha.ToLowerInvariant()) $head
$dirty=(& git -C $root status --porcelain --untracked-files=no | Out-String).Trim()
Check 'tracked-worktree-clean' ([string]::IsNullOrEmpty($dirty)) 'Tracked source must be clean'
$release=Join-Path $root ('.releases/'+$CandidateSha.ToLowerInvariant())
$manifest=Join-Path $root ('.releases/'+$CandidateSha.ToLowerInvariant()+'.manifest.json')
Check 'candidate-release-present' ((Test-Path $release -PathType Container) -and (Test-Path $manifest -PathType Leaf)) 'Prepared release and manifest required'
Check 'candidate-release-signature' $false 'Ubuntu signature authority and signed receipt not yet verified'
Check 'rollback-release-signature' $false 'Signed rollback not yet verified'
try {
 $health=Invoke-RestMethod -Uri 'http://127.0.0.1:8791/healthz' -TimeoutSec 4
 Check 'worker-health' ([bool]$health.ok -and $health.browserMode -ceq 'external-browser-cdp') 'Healthy external CDP worker required'
} catch {Check 'worker-health' $false 'Worker health unavailable or incompatible'}
try {
 $edge=Invoke-RestMethod -Uri 'http://127.0.0.1:9224/json/version' -TimeoutSec 4
 Check 'edge-cdp' ([bool]$edge.webSocketDebuggerUrl) 'Edge CDP 9224 reachable'
} catch {Check 'edge-cdp' $false 'Edge CDP unavailable'}
try {
 $lines=@(& ss -H -ltnp 'sport = :8791' 2>$null)
 if($LASTEXITCODE -ne 0 -or $lines.Count -ne 1){throw 'LISTENER_UNVERIFIED'}
 $match=[regex]::Match([string]$lines[0],'pid=(\d+)')
 if(-not $match.Success){throw 'PID_UNVERIFIED'}
 $workerPid=[int]$match.Groups[1].Value
 $cmdline=[IO.File]::ReadAllText("/proc/$workerPid/cmdline").Replace([char]0,' ')
 $status=[IO.File]::ReadAllText("/proc/$workerPid/status")
 $uidMatch=[regex]::Match($status,'(?m)^Uid:\s+(\d+)')
 $selfUidMatch=[regex]::Match([IO.File]::ReadAllText('/proc/self/status'),'(?m)^Uid:\s+(\d+)')
 $entryOk=($cmdline -match 'playwright-worker[/\\]src[/\\]worker\.js')
 $uidOk=($uidMatch.Success -and $selfUidMatch.Success -and $uidMatch.Groups[1].Value -ceq $selfUidMatch.Groups[1].Value)
 Check 'worker-ownership' ($entryOk -and $uidOk) ('PID '+$workerPid+'; entrypoint='+$entryOk+'; uid='+$uidOk)
} catch {Check 'worker-ownership' $false 'Listener, PID, UID or entrypoint not authoritatively verified'}
Check 'exclusive-drain-acknowledgment' $false 'No authenticated WORKER_DRAINED acknowledgment'
$ready=@($checks|Where-Object {-not $_.passed}).Count -eq 0
@{ok=$true;status=if($ready){'UBUNTU_CUTOVER_ADMITTED'}else{'UBUNTU_CUTOVER_BLOCKED'};activationReady=$ready;checks=$checks.ToArray();runtime_mutated=$false;browser_mutated=$false}|ConvertTo-Json -Depth 6 -Compress
