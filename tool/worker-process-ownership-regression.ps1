param([Parameter(Mandatory)][string]$ConsoleRoot)
$ErrorActionPreference='Stop'
. (Join-Path $ConsoleRoot 'tool/test-fixture.ps1')
. (Join-Path $PSScriptRoot 'dev-web.d/20-process-support.ps1')
. (Join-Path $PSScriptRoot 'dev-web.d/40-worker-lifecycle.ps1')
$fixture=New-ConsoleTestFixture -Prefix 'browser-worker-ownership'
$processes=[Collections.Generic.List[Diagnostics.Process]]::new()
$WorkerRoot=Join-Path $fixture 'playwright-worker'
$WorkerPidFile=Join-Path $fixture 'worker.pid'
$restoreDebugPort=$env:BROWSER_MCP_REMOTE_DEBUGGING_PORT
function Ensure-Directories {}
function Get-NodeCommand {Get-Command node}
function Get-WorkerPort {return $script:fixturePort}
function Stop-TreeProcess {throw 'Tree killing is forbidden in worker-only restart'}
function Get-WorkerState {
    @{pid=if($script:fixtureWorker -and -not $script:fixtureWorker.HasExited){$script:fixtureWorker.Id}else{$null}}
}
function Start-OwnedFixtureNode([string[]]$Arguments,[string]$StatePath) {
    $info=[Diagnostics.ProcessStartInfo]::new((Get-NodeCommand).Source)
    $info.UseShellExecute=$false;$info.CreateNoWindow=$true
    foreach($argument in $Arguments){$info.ArgumentList.Add($argument)}
    if($StatePath){$info.Environment['WORKER_OWNERSHIP_FIXTURE_STATE']=$StatePath}
    $process=[Diagnostics.Process]::Start($info)
    $null=$process.Handle;$processes.Add($process)
    return $process
}
try {
    $null=[IO.Directory]::CreateDirectory((Join-Path $WorkerRoot 'src'))
    $entry=Join-Path $WorkerRoot 'src/worker.js'
    $foreignEntry=Join-Path $fixture 'foreign.js'
    $statePath=Join-Path $fixture 'state.json'
    [IO.File]::WriteAllText((Join-Path $fixture 'package.json'),'{"type":"commonjs"}')
    @'
const fs=require('node:fs'),http=require('node:http');
const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,browserMode:'external-browser-cdp'}))});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.env.WORKER_OWNERSHIP_FIXTURE_STATE,JSON.stringify({port:server.address().port})));
'@ | Set-Content -LiteralPath $entry
    [IO.File]::Copy($entry,$foreignEntry)
    $legitimate=Start-OwnedFixtureNode @('--enable-source-maps',$entry) $statePath
    $deadline=[datetime]::UtcNow.AddSeconds(10)
    while(-not (Test-Path -LiteralPath $statePath)){
        if($legitimate.HasExited -or [datetime]::UtcNow -gt $deadline){throw 'Owned fixture failed to start'}
        Start-Sleep -Milliseconds 50
    }
    $state=Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
    $script:fixturePort=[int]$state.port
    $externalStatePath=Join-Path $fixture 'external-browser-state.json'
    $foreign=Start-OwnedFixtureNode @('--enable-source-maps',$foreignEntry) $externalStatePath
    while(-not (Test-Path -LiteralPath $externalStatePath)){
        if($foreign.HasExited -or [datetime]::UtcNow -gt $deadline){throw 'External inert fixture failed to start'}
        Start-Sleep -Milliseconds 50
    }
    $externalState=Get-Content -Raw -LiteralPath $externalStatePath | ConvertFrom-Json
    $env:BROWSER_MCP_REMOTE_DEBUGGING_PORT=[string]$externalState.port
    $script:fixtureWorker=$foreign
    Set-Content -LiteralPath $WorkerPidFile -Value $foreign.Id
    $rejected=$false
    try{Stop-Worker | Out-Null}catch{if($_.Exception.Message -cne 'WORKER_ENTRYPOINT_MISMATCH'){throw};$rejected=$true}
    if(-not $rejected -or $foreign.HasExited -or -not (Test-Path -LiteralPath $WorkerPidFile)){throw 'Foreign PID was not preserved'}
    $script:fixtureWorker=$legitimate
    Set-Content -LiteralPath $WorkerPidFile -Value $legitimate.Id
    $env:BROWSER_MCP_REMOTE_DEBUGGING_PORT=[string]$script:fixturePort
    $browserOwnerRejected=$false
    try{Stop-Worker | Out-Null}catch{if($_.Exception.Message -cne 'WORKER_OWNS_BROWSER'){throw};$browserOwnerRejected=$true}
    if(-not $browserOwnerRejected -or $legitimate.HasExited){throw 'Worker-owned browser boundary was not preserved'}
    $env:BROWSER_MCP_REMOTE_DEBUGGING_PORT=[string]$externalState.port
    Stop-Worker | Out-Null
    $legitimate.Refresh();$foreign.Refresh()
    $observed=@{workerExited=$legitimate.HasExited;independentBrowserExited=$foreign.HasExited}
    if(-not $legitimate.HasExited -or $foreign.HasExited){throw ('Worker-only process state: '+($observed | ConvertTo-Json -Compress))}
    if(Test-Path -LiteralPath $WorkerPidFile){throw 'Stopped owned PID receipt remained'}
    @{ok=$true;status='WORKER_PROCESS_OWNERSHIP_PASS';foreignPidRejected=$true;browserOwnerRejected=$true;independentBrowserPreserved=$true;workerOnlyStopped=$true;productionChanged=$false} | ConvertTo-Json
}finally{
    foreach($process in $processes){try{if(-not $process.HasExited){$process.Kill();$null=$process.WaitForExit(5000)}}finally{$process.Dispose()}}
    Remove-ConsoleTestFixture $fixture
    if($null -eq $restoreDebugPort){Remove-Item Env:BROWSER_MCP_REMOTE_DEBUGGING_PORT -ErrorAction SilentlyContinue}else{$env:BROWSER_MCP_REMOTE_DEBUGGING_PORT=$restoreDebugPort}
}
