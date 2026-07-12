param(
  [ValidateSet("Install", "Remove")]
  [string]$Action = "Install",
  [ValidateRange(1, 60)]
  [int]$IntervalMinutes = 5
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$taskNames = @("FoodPantryForecastJobs", "FoodPantryMessagingJobs")

if ($Action -eq "Remove") {
  $taskNames | ForEach-Object {
    Unregister-ScheduledTask -TaskName $_ -Confirm:$false -ErrorAction SilentlyContinue
  }
  Write-Output "Removed local Food Pantry job tasks."
  exit 0
}

$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

@(
  @{ Name = "FoodPantryForecastJobs"; Script = "forecast:run-jobs" },
  @{ Name = "FoodPantryMessagingJobs"; Script = "messaging:run-jobs" }
) | ForEach-Object {
  $powershell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $workerCommand = "& '$pnpm' --dir '$projectRoot' $($_.Script)"
  $scheduledTaskAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$workerCommand`""
  Register-ScheduledTask -TaskName $_.Name -Action $scheduledTaskAction -Trigger $trigger -Settings $settings -Description "Runs Food Pantry $($_.Script) locally." -Force | Out-Null
}

Write-Output "Installed local Food Pantry job tasks every $IntervalMinutes minute(s)."
