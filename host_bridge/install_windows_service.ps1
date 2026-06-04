param(
    [string]$Python = "python",
    [string]$TaskName = "Odysseus Host Access Bridge"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ModuleName = "host_bridge.mcp_app"

$action = New-ScheduledTaskAction -Execute $Python -Argument "-m $ModuleName" -WorkingDirectory $RepoRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Installed user-level startup task: $TaskName"
Write-Host "It will run as $env:USERNAME at logon."
