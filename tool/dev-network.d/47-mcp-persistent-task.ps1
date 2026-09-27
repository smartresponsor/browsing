function Install-McpStartupTask {
    Import-Module ScheduledTasks -ErrorAction Stop
    $pwsh = Get-Command pwsh.exe -ErrorAction Stop
    $launcherPath = Join-Path $Root 'tool\start-persistent-mcp.ps1'
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
        throw "Persistent MCP launcher was not found: $launcherPath"
    }

    $argument = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcherPath + '"'
    $action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument $argument -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

    Register-ScheduledTask -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keep the local Network MCP server running under Windows Task Scheduler.' -Force | Out-Null
    return (Show-McpStartupTask)
}

function Start-McpStartupTask {
    Import-Module ScheduledTasks -ErrorAction Stop
    $task = Get-ScheduledTask -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
    if (-not $task) {
        throw 'Network MCP startup task is not installed. Run install-mcp-startup-task first.'
    }

    $state = Get-McpState
    if ($state.pid) {
        Stop-McpServer | Out-Null
        Start-Sleep -Milliseconds 500
    } elseif ($state.port_conflict) {
        throw "Cannot start persistent Network MCP because port $($state.port) is owned by an unmanaged process."
    }

    Start-ScheduledTask -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath

    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 250
        $state = Get-McpState
        if ($state.running) {
            $smoke = Invoke-McpSmoke | ConvertFrom-Json
            if (-not $smoke.ok) {
                throw 'Persistent Network MCP started but MCP smoke failed.'
            }

            return [pscustomobject]@{
                ok = $true
                task = Show-McpStartupTask | ConvertFrom-Json
                mcp = $state
                smoke = $smoke
            } | ConvertTo-Json -Depth 10
        }
    } while ((Get-Date) -lt $deadline)

    $taskState = Show-McpStartupTask | ConvertFrom-Json
    throw "Persistent Network MCP did not become ready in time. Task state: $($taskState.state)"
}

function Stop-McpStartupTask {
    Import-Module ScheduledTasks -ErrorAction Stop
    $task = Get-ScheduledTask -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
    if ($task -and [string]$task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 750
    }

    $state = Get-McpState
    if ($state.pid) {
        Stop-McpServer | Out-Null
    }

    return [pscustomobject]@{
        ok = $true
        task = Show-McpStartupTask | ConvertFrom-Json
        mcp = Get-McpState
    } | ConvertTo-Json -Depth 8
}

function Uninstall-McpStartupTask {
    Import-Module ScheduledTasks -ErrorAction Stop
    Stop-McpStartupTask | Out-Null
    $existing = Get-ScheduledTask -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath -Confirm:$false | Out-Null
    }

    return [pscustomobject]@{
        task_name = $McpStartupTaskName
        removed = [bool]$existing
    } | ConvertTo-Json -Depth 4
}

function Show-McpStartupTask {
    Import-Module ScheduledTasks -ErrorAction Stop
    $task = Get-ScheduledTask -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
    if (-not $task) {
        return [pscustomobject]@{
            task_name = $McpStartupTaskName
            task_path = $StartupTaskPath
            exists = $false
            mcp = Get-McpState
        } | ConvertTo-Json -Depth 6
    }

    $info = Get-ScheduledTaskInfo -TaskName $McpStartupTaskName -TaskPath $StartupTaskPath -ErrorAction SilentlyContinue
    $action = $task.Actions | Select-Object -First 1
    $trigger = $task.Triggers | Select-Object -First 1

    return [pscustomobject]@{
        task_name = $McpStartupTaskName
        task_path = $StartupTaskPath
        exists = $true
        state = [string]$task.State
        last_run_time = if ($info) { $info.LastRunTime } else { $null }
        next_run_time = if ($info) { $info.NextRunTime } else { $null }
        last_task_result = if ($info) { $info.LastTaskResult } else { $null }
        action = if ($action) {
            [pscustomobject]@{
                execute = $action.Execute
                arguments = $action.Arguments
                working_directory = $action.WorkingDirectory
            }
        } else {
            $null
        }
        trigger = if ($trigger) {
            [pscustomobject]@{
                enabled = $trigger.Enabled
                start_boundary = $trigger.StartBoundary
            }
        } else {
            $null
        }
        mcp = Get-McpState
    } | ConvertTo-Json -Depth 8
}

