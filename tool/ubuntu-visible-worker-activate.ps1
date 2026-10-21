# Attended Ubuntu rollout, preserving all CDP instances and the old Git checkout.
# Run Activate only in alex's interactive terminal; MCP NoNewPrivileges cannot restart systemd.
[CmdletBinding()]
param(
  [ValidateSet('Preflight','Activate','UpgradePreflight','Upgrade')][string]$Mode='Preflight',
  [switch]$ConfirmDeploy
)
$ErrorActionPreference='Stop'
if (-not $IsLinux) { throw 'UBUNTU_ONLY' }
$Repo='/home/alex/smartresponse/mcp/looping/browsing'
$Unit='console-mcp-visible-worker.service'
$ApprovedBase='d53cc3cbac88ca90a8460dca07f19a44c71effa9'
$AllowedReleaseChange='tool/ubuntu-visible-worker-activate.ps1'
$OldBranch='fix/ubuntu-temporal-interactions'
$OldHead='e5763b49b94e9686525a1a1effd4c830c427aab9'
$Supervisor='/home/alex/smartresponse/mcp/console-mcp/ops/ubuntu/script/visible-worker.py'
$Worker=Join-Path $Repo 'playwright-worker/src/worker.js'
$Journal=Join-Path $Repo 'var/run/visible-worker-master-deploy.json'

function Git([string[]]$Arguments) {
  $lines=@(& /usr/bin/git -C $Repo @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) { throw ('GIT_FAILED '+($Arguments -join ' ')+': '+($lines -join ' ')) }
  return (($lines -join [Environment]::NewLine).Trim())
}
function UnitProps {
  $lines=@(& /usr/bin/systemctl show $Unit --no-pager -p LoadState -p ActiveState -p MainPID -p FragmentPath -p ExecStart -p PartOf -p BindsTo -p PropagatesStopTo)
  if ($LASTEXITCODE -ne 0) { throw 'WORKER_UNIT_UNAVAILABLE' }
  $values=@{}
  foreach ($line in $lines) {
    $pair=$line -split '=',2
    if ($pair.Count -eq 2) { $values[$pair[0]]=$pair[1] }
  }
  return $values
}
function BrowserInstances {
  $items=@{}
  foreach ($port in @(9223,9224,9230)) {
    $doc=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$port+'/json/version') -TimeoutSec 4
    $socket=[uri]([string]$doc.webSocketDebuggerUrl)
    if ($socket.Scheme -ne 'ws' -or $socket.Host -ne '127.0.0.1' -or $socket.Port -ne $port) {
      throw ('CDP_IDENTITY_UNVERIFIED_'+$port)
    }
    $items[[string]$port]=$socket.AbsolutePath
  }
  return $items
}
function LiveWorker {
  try {
    $result=Invoke-RestMethod -Uri 'http://127.0.0.1:8793/healthz' -TimeoutSec 3
    if ($result.ok -ne $true) { return $null }
    return $result
  } catch { return $null }
}
function NoWorkerConnections {
  $lines=@(& /usr/bin/ss -Htn state established '( sport = :8793 )' 2>$null)
  if ($LASTEXITCODE -ne 0) { throw 'WORKER_CONNECTION_CHECK_UNAVAILABLE' }
  if (@($lines | Where-Object { $_ -match '\S' }).Count -gt 0) { throw 'VISIBLE_WORKER_HAS_ACTIVE_TCP_CLIENTS' }
}
function NativeRun([string]$Executable,[string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('COMMAND_FAILED '+$Executable+' '+($Arguments -join ' ')) }
}
function CompareInstances($before) {
  $after=BrowserInstances
  foreach ($port in @('9223','9224','9230')) {
    if ($after[$port] -ne $before[$port]) { throw ('BROWSER_INSTANCE_CHANGED_'+$port) }
  }
}
function NoNewPrivs {
  $line=Get-Content '/proc/self/status' | Where-Object { $_ -match '^NoNewPrivs:' } | Select-Object -First 1
  if ($line -match 'NoNewPrivs:\s*(\d+)') { return [int]$Matches[1] }
  throw 'PRIVILEGE_BOUNDARY_UNKNOWN'
}

# Controlled in-place patch release for an already active master checkout.
# This path never resets Git, drops user files, or restarts any Edge instance.
if ($Mode -in @('UpgradePreflight','Upgrade')) {
  $previous='b1c1058c5396e8ea58123590762cffc0f047053a'
  $requiredFix='1ef022af71c4cafd50f636c831f8e0bd3a4eb235'
  $releaseJournal=Join-Path $Repo 'var/run/visible-worker-upgrade.json'
  if ((Git @('branch','--show-current')) -ne 'master') { throw 'ACTIVE_BRANCH_NOT_MASTER' }
  if ((Git @('rev-parse','HEAD')) -ne $previous) { throw 'ACTIVE_MASTER_NOT_EXPECTED_PREVIOUS_VERSION' }
  if ((Git @('status','--porcelain=v1','--untracked-files=no')) -ne '') { throw 'TRACKED_CHANGES_PRESENT' }
  if ((Git @('remote','get-url','origin')) -ne 'https://github.com/smartresponsor/browsing.git') { throw 'UNEXPECTED_REMOTE' }
  $remote=Git @('rev-parse','refs/remotes/origin/master')
  & /usr/bin/git -C $Repo merge-base --is-ancestor $previous $remote
  if ($LASTEXITCODE -ne 0) { throw 'REMOTE_NOT_FAST_FORWARD' }
  & /usr/bin/git -C $Repo merge-base --is-ancestor $requiredFix $remote
  if ($LASTEXITCODE -ne 0) { throw 'REQUIRED_CDP_PROFILE_FIX_ABSENT' }
  $allowed=@('playwright-worker/src/worker.js','tool/web-external-cdp-attach-regression.mjs','tool/ubuntu-visible-worker-activate.ps1')
  $changed=@(& /usr/bin/git -C $Repo diff --name-only $previous $remote)
  if ($LASTEXITCODE -ne 0) { throw 'UPGRADE_DIFF_AUDIT_FAILED' }
  foreach ($file in $changed) { if ($file -notin $allowed) { throw ('UNREVIEWED_UPGRADE_FILE_'+$file) } }
  if ('playwright-worker/src/worker.js' -notin $changed) { throw 'VISIBLE_WORKER_FIX_NOT_PRESENT' }
  $newPaths=@(& /usr/bin/git -C $Repo diff --name-only --diff-filter=A $previous $remote)
  if ($LASTEXITCODE -ne 0) { throw 'UPGRADE_NEW_PATH_AUDIT_FAILED' }
  $untracked=@(& /usr/bin/git -C $Repo ls-files --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) { throw 'UNTRACKED_INVENTORY_FAILED' }
  $untrackedHashes=@{}
  foreach ($file in $untracked) {
    if ($file -in $newPaths) { throw ('UPGRADE_WOULD_OVERWRITE_UNTRACKED_'+$file) }
    $full=Join-Path $Repo $file
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw ('UNTRACKED_PATH_INACCESSIBLE_'+$file) }
    $untrackedHashes[$file]=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
  }
  $unitProps=UnitProps
  if ($unitProps.ActiveState -ne 'active' -or [int]$unitProps.MainPID -lt 1) { throw 'VISIBLE_WORKER_NOT_ACTIVE' }
  if ($unitProps.FragmentPath -ne '/etc/systemd/system/console-mcp-visible-worker.service') { throw 'UNEXPECTED_SYSTEMD_UNIT' }
  if (-not $unitProps.ExecStart.Contains($Supervisor)) { throw 'UNEXPECTED_WORKER_SUPERVISOR' }
  $baseline=BrowserInstances
  $live=LiveWorker
  if ($null -eq $live -or $live.browserMode -ne 'external-browser-cdp') { throw 'VISIBLE_WORKER_HEALTH_NOT_READY' }
  NoWorkerConnections
  $boundary=NoNewPrivs
  $summary=[ordered]@{ok=$true;status='VISIBLE_WORKER_HOTFIX_PREFLIGHT_GREEN';old=$previous;new=$remote;
    permittedPaths=$changed;untrackedFiles=$untracked.Count;workerPid=[int]$unitProps.MainPID;
    cdpPorts=@(9223,9224,9230);noNewPrivileges=$boundary}
  if ($Mode -eq 'UpgradePreflight') {
    $summary | ConvertTo-Json -Compress -Depth 5
    exit 0
  }
  if (-not $ConfirmDeploy) { throw 'CONFIRM_DEPLOY_SWITCH_REQUIRED' }
  if ((& /usr/bin/id -un).Trim() -ne 'alex') { throw 'RUN_FROM_ALEX_INTERACTIVE_TERMINAL' }
  if ($boundary -ne 0) { throw 'MCP_SANDBOX_CANNOT_ADMINISTER_SYSTEMD' }
  # Operator enters credentials only in their own terminal; never in Console MCP.
  NativeRun '/usr/bin/sudo' @('-v')
  NoWorkerConnections
  CompareInstances $baseline
  $journalData=[ordered]@{status='PREPARED';old=$previous;new=$remote;
    at=(Get-Date).ToString('o');browserInstances=$baseline}
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $releaseJournal) | Out-Null
  ($journalData | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $releaseJournal -Encoding utf8
  $pulled=$false
  $restartAttempted=$false
  try {
    NativeRun '/usr/bin/git' @('-C',$Repo,'pull','--ff-only','origin','master')
    $pulled=$true
    if ((Git @('rev-parse','HEAD')) -ne $remote) { throw 'MASTER_UPGRADE_SHA_MISMATCH' }
    foreach ($file in $untracked) {
      $full=Join-Path $Repo $file
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw ('UNTRACKED_REMOVED_'+$file) }
      if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ne $untrackedHashes[$file]) { throw ('UNTRACKED_CHANGED_'+$file) }
    }
    NativeRun '/usr/bin/npm' @('--prefix',$Repo,'run','typecheck')
    NativeRun '/usr/bin/npm' @('--prefix',$Repo,'test')
    NoWorkerConnections
    CompareInstances $baseline
    # Tests may outlast sudo's cached authorization; renew explicitly in the attended terminal.
    NativeRun '/usr/bin/sudo' @('-v')
    $restartAttempted=$true
    NativeRun '/usr/bin/sudo' @('-n','/usr/bin/systemctl','restart',$Unit)
    $restarted=$false
    for($i=0;$i -lt 20;$i++) {
      Start-Sleep -Seconds 1
      $after=UnitProps
      $ready=LiveWorker
      if ($after.ActiveState -eq 'active' -and [int]$after.MainPID -gt 0 -and
          [int]$after.MainPID -ne [int]$unitProps.MainPID -and $ready -and
          $ready.browserMode -eq 'external-browser-cdp') { $restarted=$true;break }
    }
    if (-not $restarted) { throw 'NEW_WORKER_HEALTH_UNVERIFIED' }
    CompareInstances $baseline
    $journalData.status='UPGRADE_COMMITTED'
    $journalData.finishedAt=(Get-Date).ToString('o')
    $journalData.workerPid=[int]$after.MainPID
    ($journalData | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $releaseJournal -Encoding utf8
    [pscustomobject]@{ok=$true;status='UPGRADE_COMMITTED';head=$remote;pid=[int]$after.MainPID;
      browserInstancesPreserved=$true;next='NELLIS_EXACT_TARGET_READ_ONLY_ACCEPTANCE'} | ConvertTo-Json -Compress
  } catch {
    $failure=$_.Exception.Message
    $steps=@()
    if ($pulled) {
      # Restore the previous proven worker source without resetting master or touching user files.
      try {
        NativeRun '/usr/bin/git' @('-C',$Repo,'restore',('--source='+$previous),'--worktree','--','playwright-worker/src/worker.js')
        $steps+='OLD_WORKER_SOURCE_RESTORED'
      } catch { $steps+=('RESTORE_FAILED: '+$_.Exception.Message) }
    }
    if ($restartAttempted) {
      try {
        NativeRun '/usr/bin/sudo' @('-n','/usr/bin/systemctl','restart',$Unit)
        $steps+='OLD_WORKER_RESTARTED'
      } catch { $steps+=('WORKER_RESTART_ROLLBACK_FAILED: '+$_.Exception.Message) }
    }
    try { CompareInstances $baseline;$steps+='CDP_INSTANCES_PRESERVED' } catch { $steps+=('CDP_CHECK_FAILED: '+$_.Exception.Message) }
    $journalData.status='ROLLBACK_ATTEMPTED'
    $journalData.error=$failure
    $journalData.steps=$steps
    ($journalData | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $releaseJournal -Encoding utf8
    throw ('VISIBLE_WORKER_UPGRADE_ABORTED: '+$failure+'; '+($steps -join '; '))
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $Worker) -or -not (Test-Path -LiteralPath $Supervisor)) { throw 'CANONICAL_SOURCE_MISSING' }
if ((Git @('remote','get-url','origin')) -ne 'https://github.com/smartresponsor/browsing.git') { throw 'UNEXPECTED_GIT_REMOTE' }
$currentBranch=Git @('branch','--show-current')
$currentHead=Git @('rev-parse','HEAD')
$master=Git @('rev-parse','refs/heads/master')
$remoteMaster=Git @('rev-parse','refs/remotes/origin/master')
if ($master -ne $remoteMaster) { throw 'MASTER_AND_ORIGIN_NOT_SYNCHRONIZED' }
& /usr/bin/git -C $Repo merge-base --is-ancestor $ApprovedBase $master
if ($LASTEXITCODE -ne 0) { throw 'REVIEWED_CODE_NOT_CONTAINED_IN_MASTER' }
$delta=@(& /usr/bin/git -C $Repo diff --name-only $ApprovedBase $master)
if ($LASTEXITCODE -ne 0) { throw 'RELEASE_DELTA_AUDIT_FAILED' }
foreach ($path in $delta) {
  if ($path -ne $AllowedReleaseChange) { throw ('UNREVIEWED_MASTER_CHANGE_'+$path) }
}
$ExpectedMaster=$master
if ($currentBranch -ne $OldBranch -or $currentHead -ne $OldHead) { throw 'ACTIVE_SOURCE_CHANGED_SINCE_REVIEW' }
if ((Git @('status','--porcelain=v1','--untracked-files=no')) -ne '') { throw 'TRACKED_WORKTREE_MODIFICATIONS_PRESENT' }
$trees=Git @('worktree','list','--porcelain')
if ($trees -match 'branch refs/heads/master') { throw 'MASTER_CHECKED_OUT_ELSEWHERE' }
$untracked=@(& /usr/bin/git -C $Repo ls-files --others --exclude-standard)
if ($LASTEXITCODE -ne 0) { throw 'UNTRACKED_INVENTORY_FAILED' }
# Compare content, not just count: master may legitimately begin tracking a prior
# untracked path, but none of its existing bytes may be lost or replaced.
$untrackedHash=@{}
foreach ($relative in $untracked) {
  $full=Join-Path $Repo $relative
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw ('UNTRACKED_FILE_MISSING_'+$relative) }
  $untrackedHash[$relative]=(Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash
}
$unitProps=UnitProps
if ($unitProps.LoadState -ne 'loaded' -or $unitProps.ActiveState -ne 'active' -or [int]$unitProps.MainPID -lt 1) { throw 'VISIBLE_WORKER_NOT_ACTIVE' }
if ($unitProps.FragmentPath -ne '/etc/systemd/system/console-mcp-visible-worker.service') { throw 'UNEXPECTED_UNIT_FILE' }
if (-not $unitProps.ExecStart.Contains($Supervisor)) { throw 'UNEXPECTED_UNIT_EXECUTABLE' }
foreach ($prop in @('PartOf','BindsTo','PropagatesStopTo')) {
  if (-not [string]::IsNullOrWhiteSpace($unitProps[$prop])) { throw ('UNEXPECTED_UNIT_LIFECYCLE_COUPLING_'+$prop) }
}
if (-not (Get-Content $Supervisor -Raw).Contains($Worker)) { throw 'SUPERVISOR_WORKER_SOURCE_PATH_MISMATCH' }
$instances=BrowserInstances
$health=LiveWorker
if ($null -eq $health -or [string]$health.browserMode -ne 'external-browser-cdp') { throw 'VISIBLE_WORKER_HEALTH_UNVERIFIED' }
NoWorkerConnections
$boundary=NoNewPrivs
$preflight=[ordered]@{
  ok=$true; status='VISIBLE_WORKER_MASTER_PREFLIGHT_GREEN'
  sourceBranch=$currentBranch; sourceHead=$currentHead
  reviewedMaster=$master; unit=$Unit; supervisorPid=[int]$unitProps.MainPID
  protectedCdpPorts=@(9223,9224,9230); untrackedFilesPreserved=$untracked.Count
  workerHealthVerified=$true; noNewPrivileges=$boundary
}
if ($Mode -eq 'Preflight') {
  $preflight | ConvertTo-Json -Compress -Depth 5
  exit 0
}
if (-not $ConfirmDeploy) { throw 'CONFIRM_DEPLOY_SWITCH_REQUIRED' }
if ((& /usr/bin/id -un).Trim() -ne 'alex') { throw 'RUN_FROM_ALEX_INTERACTIVE_TERMINAL' }
if ($boundary -ne 0) { throw 'MCP_SANDBOX_CANNOT_ADMINISTER_SYSTEMD' }
# Sudo prompts only in the operator's interactive terminal. No password enters MCP.
NativeRun '/usr/bin/sudo' @('-v')
NoWorkerConnections
CompareInstances $instances
$journalData=[ordered]@{status='PREPARED';branch=$currentBranch;head=$currentHead;master=$master;unit=$Unit;createdAt=(Get-Date).ToString('o');browserInstances=$instances}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Journal) | Out-Null
($journalData | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $Journal -Encoding utf8
$switched=$false; $restartAttempted=$false
try {
  NativeRun '/usr/bin/git' @('-C',$Repo,'switch','master')
  $switched=$true
  if ((Git @('rev-parse','HEAD')) -ne $ExpectedMaster) { throw 'MASTER_SWITCH_INCONSISTENT' }
  foreach ($relative in $untracked) {
    $full=Join-Path $Repo $relative
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw ('UNTRACKED_FILE_REMOVED_'+$relative) }
    if ((Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash -ne $untrackedHash[$relative]) {
      throw ('UNTRACKED_FILE_MODIFIED_'+$relative)
    }
  }
  NativeRun '/usr/bin/npm' @('--prefix',$Repo,'run','typecheck')
  NativeRun '/usr/bin/npm' @('--prefix',$Repo,'test')
  NoWorkerConnections
  CompareInstances $instances
  # Refresh sudo authorization before entering the service-restart boundary.
  NativeRun '/usr/bin/sudo' @('-n','-v')
  $restartAttempted=$true
  NativeRun '/usr/bin/sudo' @('-n','/usr/bin/systemctl','restart',$Unit)
  $started=$false
  for ($attempt=0;$attempt -lt 20;$attempt++) {
    Start-Sleep -Seconds 1
    $now=UnitProps
    $live=LiveWorker
    if ($now.ActiveState -eq 'active' -and [int]$now.MainPID -gt 0 -and $live -and $live.browserMode -eq 'external-browser-cdp') {
      $started=$true; break
    }
  }
  if (-not $started) { throw 'WORKER_RESTART_POSTCONDITION_FAILED' }
  CompareInstances $instances
  if ((Git @('branch','--show-current')) -ne 'master') { throw 'MASTER_NOT_ACTIVE' }
  $journalData.status='DEPLOY_COMMITTED'
  $journalData.deployedAt=(Get-Date).ToString('o')
  $journalData.newSupervisorPid=[int]$now.MainPID
  ($journalData | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $Journal -Encoding utf8
  [pscustomobject]@{ok=$true;status='DEPLOY_COMMITTED';head=$ExpectedMaster;supervisorPid=[int]$now.MainPID;browserInstancesPreserved=$true;capturePending='MCP_READ_ONLY_NELLIS_ACCEPTANCE'} | ConvertTo-Json -Compress
} catch {
  $cause=$_.Exception.Message
  $rollback=@()
  if ($switched) {
    try {
      NativeRun '/usr/bin/git' @('-C',$Repo,'switch',$currentBranch)
      if ((Git @('rev-parse','HEAD')) -ne $currentHead) { throw 'ROLLBACK_SOURCE_HEAD_CHANGED' }
      $rollback+='GIT_RESTORED'
    } catch { $rollback+=('GIT_ROLLBACK_FAILED: '+$_.Exception.Message) }
  }
  # Even a failed restart command can leave the unit partially stopped.
  if ($restartAttempted) {
    try {
      NativeRun '/usr/bin/sudo' @('-n','/usr/bin/systemctl','restart',$Unit)
      $rollback+='WORKER_RESTARTED_ON_OLD_SOURCE'
    } catch { $rollback+=('WORKER_ROLLBACK_FAILED: '+$_.Exception.Message) }
  }
  try { CompareInstances $instances; $rollback+='CDP_IDENTITIES_PRESERVED' } catch { $rollback+=('CDP_PRESERVATION_UNKNOWN: '+$_.Exception.Message) }
  $journalData.status='ROLLBACK_ATTEMPTED'
  $journalData.error=$cause
  $journalData.rollback=$rollback
  ($journalData | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $Journal -Encoding utf8
  throw ('VISIBLE_WORKER_DEPLOY_ABORTED: '+$cause+'; '+($rollback -join '; '))
}
