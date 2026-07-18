param([switch]$KeepData)

$ErrorActionPreference = "Stop"
$taskName = "PantryAssistantApp"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName "Pantry Assistant TCP *" -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
if (-not $KeepData) {
  Write-Warning "Application files and PostgreSQL databases were intentionally preserved. Create a backup before removing them manually."
}
Write-Output "Pantry Assistant startup registration removed."
