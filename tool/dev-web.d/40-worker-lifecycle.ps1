function Start-Worker {
    Ensure-Directories
    Ensure-SharedBrowserEnvironment

    $state = Get-WorkerState
    if ($state.running) {
        return $state
    }

    if ($state.port_conflict) {
        throw "playwright-worker cannot start because port $($state.port) is already in use by another process."
    }

    Remove-Item -LiteralPath $WorkerPidFile -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $WorkerLogFile -Value '' -Encoding utf8
    Set-Content -LiteralPath $WorkerErrFile -Value '' -Encoding utf8

    $node = Get-NodeCommand
    $workerScript = Join-Path $WorkerRoot 'src\worker.js'
    $restorePort = $env:PORT
    $env:PORT = [string](Get-WorkerPort)

    try {
        $process = Start-Process `
            -FilePath $node.Source `
            -ArgumentList @('--enable-source-maps', ('"'+$workerScript+'"')) `
            -WorkingDirectory $Root `
            -WindowStyle Hidden `
            -RedirectStandardOutput $WorkerLogFile `
            -RedirectStandardError $WorkerErrFile `
            -PassThru
    } finally {
        if ($null -eq $restorePort) {
            Remove-Item -Path Env:PORT -ErrorAction SilentlyContinue
        } else {
            $env:PORT = $restorePort
        }
    }

    Set-Content -LiteralPath $WorkerPidFile -Value $process.Id -NoNewline
    if (-not (Wait-ForTcpListener -Port (Get-WorkerPort))) {
        throw 'playwright-worker did not start in time.'
    }

    return (Get-WorkerState | ConvertTo-Json -Depth 8)
}

function Stop-Worker {
    Ensure-Directories
    $state = Get-WorkerState
    if ($state.pid) {
        $owned=Get-OwnedWorkerProcess -ProcessId $state.pid
        try {
            # The external browser and its sessions are independently owned.
            # Never tree-kill them or trust an unverified reusable PID file.
            $owned.Kill()
            if(-not $owned.WaitForExit(10000)){throw 'WORKER_STOP_TIMEOUT'}
        } finally {$owned.Dispose()}
    }

    Remove-Item -LiteralPath $WorkerPidFile -Force -ErrorAction SilentlyContinue
    return (Get-WorkerState | ConvertTo-Json -Depth 8)
}

function Get-OwnedWorkerProcess {
    param([Parameter(Mandatory)][int]$ProcessId)
    if(-not $IsWindows){throw 'Use the supported systemd worker controls on Ubuntu'}
    $owned=[Diagnostics.Process]::GetProcessById($ProcessId)
    try {
        # Opening the kernel handle pins this process identity through the stop.
        $null=$owned.Handle
        $info=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ProcessId)
        if(-not $info -or $owned.HasExited){throw 'WORKER_IDENTITY_UNAVAILABLE'}
        $owner=Invoke-CimMethod -InputObject $info -MethodName GetOwnerSid
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        if($owner.ReturnValue -ne 0 -or $owner.Sid -cne $sid -or
           $info.SessionId -ne [Diagnostics.Process]::GetCurrentProcess().SessionId){throw 'WORKER_OWNER_OR_SESSION_MISMATCH'}
        if([IO.Path]::GetFullPath($info.ExecutablePath) -ine [IO.Path]::GetFullPath((Get-NodeCommand).Source)){
            throw 'WORKER_EXECUTABLE_MISMATCH'
        }
        if(-not ('BrowserWorkerArguments' -as [type])){
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BrowserWorkerArguments {
 [DllImport("shell32.dll", SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string text, out int count);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
 public static string[] Parse(string text) {
  int count; var pointer=CommandLineToArgvW(text,out count);
  if(pointer==IntPtr.Zero) throw new InvalidOperationException("Worker command-line unavailable");
  try { var args=new string[count]; for(int i=0;i<count;i++) args[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer,i*IntPtr.Size)); return args; }
  finally { LocalFree(pointer); }
 }
}
'@
        }
        $arguments=[BrowserWorkerArguments]::Parse($info.CommandLine)
        $expected=[IO.Path]::GetFullPath((Join-Path $WorkerRoot 'src/worker.js'))
        if($arguments.Count -ne 3 -or $arguments[1] -cne '--enable-source-maps' -or
           [IO.Path]::GetFullPath($arguments[2]) -ine $expected){throw 'WORKER_ENTRYPOINT_MISMATCH'}
        $listener=Get-ListeningProcessOnPort -Port (Get-WorkerPort)
        if(-not $listener -or $listener.Id -ne $ProcessId){throw 'WORKER_LISTENER_IDENTITY_MISMATCH'}
        $health=Invoke-RestMethod -Uri ('http://127.0.0.1:'+(Get-WorkerPort)+'/healthz') -NoProxy -MaximumRedirection 0 -TimeoutSec 5
        if(-not $health.ok -or $health.browserMode -cne 'external-browser-cdp'){throw 'WORKER_OWNS_BROWSER_OR_MODE_UNKNOWN'}
        $debugPort=if($env:BROWSER_MCP_REMOTE_DEBUGGING_PORT){[int]$env:BROWSER_MCP_REMOTE_DEBUGGING_PORT}else{9223}
        $browser=Get-ListeningProcessOnPort -Port $debugPort
        if(-not $browser){throw 'WORKER_EXTERNAL_BROWSER_UNAVAILABLE'}
        $ancestor=[int]$browser.Id;$visited=@{}
        for($depth=0;$ancestor -gt 0 -and $depth -lt 64;$depth++){
            if($ancestor -eq $ProcessId){throw 'WORKER_OWNS_BROWSER'}
            if($visited.ContainsKey($ancestor)){throw 'WORKER_BROWSER_ANCESTRY_AMBIGUOUS'}
            $visited[$ancestor]=$true
            $parent=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ancestor)
            if(-not $parent){break}
            $ancestor=[int]$parent.ParentProcessId
        }
        if($depth -ge 64){throw 'WORKER_BROWSER_ANCESTRY_AMBIGUOUS'}
        return $owned
    } catch {$owned.Dispose();throw}
}
