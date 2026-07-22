param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 3000,
  [switch]$SeedDemoData,
  [switch]$DisableLanAccess,
  [switch]$EnableLanTls,
  [string]$LanHostname = [System.Net.Dns]::GetHostName(),
  [switch]$BootstrapPrerequisites,
  [securestring]$PostgresAdminPassword,
  [ValidateSet("disabled", "ollama")]
  [string]$AssistantProvider = ""
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) { Write-Host "[Pantry Assistant] $Message" -ForegroundColor Cyan }
function Get-PlainSecret([string]$Prompt) {
  $secure = Read-Host -AsSecureString $Prompt
  $credential = [System.Management.Automation.PSCredential]::new("local", $secure)
  return $credential.GetNetworkCredential().Password
}
function New-Secret {
  $bytes = New-Object byte[] 48
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "A").Replace("/", "b")
}
function Get-EnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return $line.Substring($Name.Length + 1).Trim('"')
}
function Install-WindowsPackage([string]$Id, [string]$Name) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) { throw "$Name is missing and WinGet is unavailable. Install it through your approved Windows software channel, then run setup again." }
  Write-Step "Installing $Name through WinGet"
  & $winget.Source install --exact --id $Id --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "WinGet could not install $Name. Complete the official installer if it opened, then run setup again." }
}
function Resolve-Caddy {
  $command = Get-Command caddy.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidate = "C:\Program Files\Caddy\caddy.exe"
  if (Test-Path -LiteralPath $candidate) { return $candidate }
  return $null
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json"))) { throw "Run this script from the Pantry Assistant application folder." }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run Pantry Assistant setup from an elevated PowerShell window so it can create the LAN firewall rule and scheduled task." }
if ($DisableLanAccess -and $EnableLanTls) { throw "Choose either local-only mode or secure LAN access, not both." }
if ($EnableLanTls -and $LanHostname -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]{0,251}[a-zA-Z0-9]$') { throw "LanHostname must be a valid DNS name." }

Write-Step "Checking Node.js and pnpm"
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -and $BootstrapPrerequisites) {
  Install-WindowsPackage "OpenJS.NodeJS.LTS" "Node.js LTS"
  $nodeDirectory = "C:\Program Files\nodejs"
  if (Test-Path -LiteralPath $nodeDirectory) { $env:Path = "$nodeDirectory;$env:Path" }
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "Node.js 20 or newer is required. Run setup with -BootstrapPrerequisites to install it through WinGet, then rerun setup if Windows has not refreshed command paths yet." }
$nodeMajor = [int]((& $nodeCommand.Source --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer is required; found $nodeMajor." }
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpmCommand -and $BootstrapPrerequisites) {
  $corepackCommand = Get-Command corepack.exe -ErrorAction SilentlyContinue
  if (-not $corepackCommand) { throw "Corepack was not found with Node.js. Install pnpm through your approved Windows software channel, then run setup again." }
  & $corepackCommand.Source enable
  if ($LASTEXITCODE -ne 0) { throw "Corepack could not enable pnpm. Install pnpm through your approved Windows software channel, then run setup again." }
  $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
}
if (-not $pnpmCommand) { throw "pnpm is required. Run setup with -BootstrapPrerequisites or install pnpm, then run setup again." }

$caddy = $null
if ($EnableLanTls) {
  $caddy = Resolve-Caddy
  if (-not $caddy -and $BootstrapPrerequisites) {
    Install-WindowsPackage "CaddyServer.Caddy" "Caddy HTTPS proxy"
    $caddy = Resolve-Caddy
  }
  if (-not $caddy) { throw "Secure LAN access requires Caddy. Run setup with -BootstrapPrerequisites or install CaddyServer.Caddy through your approved Windows software channel." }
}

Write-Step "Checking native PostgreSQL"
$postgresService = Get-Service -Name "postgresql-x64-18" -ErrorAction SilentlyContinue
if (-not $postgresService -and $BootstrapPrerequisites) {
  Install-WindowsPackage "PostgreSQL.PostgreSQL.18" "PostgreSQL 18"
  $postgresService = Get-Service -Name "postgresql-x64-18" -ErrorAction SilentlyContinue
}
if (-not $postgresService) { throw "Native PostgreSQL 18 was not found. Run setup with -BootstrapPrerequisites to launch the official installer, set its administrator password, then run setup again." }
if ($postgresService.Status -ne "Running") { Start-Service -Name $postgresService.Name }
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$createdb = "C:\Program Files\PostgreSQL\18\bin\createdb.exe"
if (-not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $createdb)) { throw "PostgreSQL 18 command-line tools were not found." }

$envPath = Join-Path $ProjectRoot ".env.local"
$existingAppPassword = Get-EnvValue $envPath "PANTRY_APP_PASSWORD"
$existingDatabaseUrl = Get-EnvValue $envPath "DATABASE_URL"
$adminPassword = if ($PostgresAdminPassword) {
  $credential = [System.Management.Automation.PSCredential]::new("local", $PostgresAdminPassword)
  $credential.GetNetworkCredential().Password
} else { Get-PlainSecret "Enter the PostgreSQL postgres administrator password (used only during setup)" }
$appPassword = $existingAppPassword
if (-not $appPassword -and $existingDatabaseUrl) {
  $existingUri = [Uri]$existingDatabaseUrl
  if ($existingUri.UserInfo.Contains(':')) { $appPassword = [Uri]::UnescapeDataString($existingUri.UserInfo.Split(':', 2)[1]) }
}
if (-not $appPassword) { $appPassword = New-Secret }
$authSecret = Get-EnvValue $envPath "BETTER_AUTH_SECRET"
if (-not $authSecret) { $authSecret = New-Secret }
$seedPassword = Get-EnvValue $envPath "SEED_USER_PASSWORD"
if (-not $seedPassword) { $seedPassword = New-Secret }
$assistantProvider = Get-EnvValue $envPath "ASSISTANT_PROVIDER"
if ($assistantProvider -notin @("disabled", "ollama")) { $assistantProvider = "ollama" }
if ($AssistantProvider) { $assistantProvider = $AssistantProvider }
$optionalEnvNames = @("TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","TWILIO_MESSAGING_SERVICE_SID","TWILIO_PHONE_NUMBER","TWILIO_WEBHOOK_BASE_URL","VONAGE_API_KEY","VONAGE_API_SECRET","PLIVO_AUTH_ID","PLIVO_AUTH_TOKEN","TELNYX_API_KEY","TELNYX_MESSAGING_PROFILE_ID","SINCH_SERVICE_PLAN_ID","SINCH_API_TOKEN","INFOBIP_BASE_URL","INFOBIP_API_KEY","BANDWIDTH_API_TOKEN","BANDWIDTH_API_SECRET","BANDWIDTH_APPLICATION_ID","BIRD_ACCESS_KEY","BIRD_WORKSPACE_ID","BIRD_CHANNEL_ID","AWS_REGION","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SNS_SENDER_ID","AZURE_COMMUNICATION_CONNECTION_STRING","SMS_WEBHOOK_SECRET_VONAGE","SMS_WEBHOOK_SECRET_PLIVO","SMS_WEBHOOK_SECRET_TELNYX","SMS_WEBHOOK_SECRET_SINCH","SMS_WEBHOOK_SECRET_INFOBIP","SMS_WEBHOOK_SECRET_BANDWIDTH","SMS_WEBHOOK_SECRET_BIRD","SMS_WEBHOOK_SECRET_AWS_SNS","SMS_WEBHOOK_SECRET_AZURE_COMMUNICATION_SERVICES","SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASSWORD","SMTP_FROM","SMTP_SECURE")
$optionalEnv = @{}
foreach ($name in $optionalEnvNames) { $optionalEnv[$name] = Get-EnvValue $envPath $name }
$encodedPassword = [Uri]::EscapeDataString($appPassword)
$databaseUrl = if ($existingDatabaseUrl) { $existingDatabaseUrl } else { "postgresql://pantry_app:$encodedPassword@127.0.0.1:5432/food_pantry_dev" }
$testDatabaseUrl = "postgresql://pantry_app:$encodedPassword@127.0.0.1:5432/food_pantry_test"
$appUrl = if ($EnableLanTls) { "https://$LanHostname" } else { "http://localhost:$Port" }
$webhookBase = $optionalEnv.TWILIO_WEBHOOK_BASE_URL
if (-not $webhookBase) { $webhookBase = $appUrl }

$env:PGPASSWORD = $adminPassword
try {
  $roleExists = (& $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -tAc "select 1 from pg_roles where rolname='pantry_app'").Trim()
  if ($roleExists -eq "1") {
    & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "alter role pantry_app with login nosuperuser nocreatedb nocreaterole noinherit password '$($appPassword.Replace("'", "''"))';" | Out-Null
  } else {
    & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "create role pantry_app login nosuperuser nocreatedb nocreaterole noinherit password '$($appPassword.Replace("'", "''"))';" | Out-Null
  }
  foreach ($database in @("food_pantry_dev", "food_pantry_test")) {
    $exists = (& $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -tAc "select 1 from pg_database where datname='$database'").Trim()
    if ($exists -ne "1") { & $createdb -h 127.0.0.1 -p 5432 -U postgres -O pantry_app $database }
  }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }

@(
  "DATABASE_URL=$databaseUrl",
  "TEST_DATABASE_URL=$testDatabaseUrl",
  "BETTER_AUTH_SECRET=$authSecret",
  "BETTER_AUTH_URL=$appUrl",
  "APP_URL=$appUrl",
  "SEED_USER_PASSWORD=$seedPassword",
  "ASSISTANT_PROVIDER=$assistantProvider",
  "OLLAMA_ASSISTANT_BASE_URL=http://127.0.0.1:11434",
  "OLLAMA_ASSISTANT_MODEL=qwen3:8b",
  "TWILIO_ACCOUNT_SID=$($optionalEnv.TWILIO_ACCOUNT_SID)",
  "TWILIO_AUTH_TOKEN=$($optionalEnv.TWILIO_AUTH_TOKEN)",
  "TWILIO_MESSAGING_SERVICE_SID=$($optionalEnv.TWILIO_MESSAGING_SERVICE_SID)",
  "TWILIO_PHONE_NUMBER=$($optionalEnv.TWILIO_PHONE_NUMBER)",
  "TWILIO_WEBHOOK_BASE_URL=$webhookBase",
  "VONAGE_API_KEY=$($optionalEnv.VONAGE_API_KEY)",
  "VONAGE_API_SECRET=$($optionalEnv.VONAGE_API_SECRET)",
  "PLIVO_AUTH_ID=$($optionalEnv.PLIVO_AUTH_ID)",
  "PLIVO_AUTH_TOKEN=$($optionalEnv.PLIVO_AUTH_TOKEN)",
  "TELNYX_API_KEY=$($optionalEnv.TELNYX_API_KEY)",
  "TELNYX_MESSAGING_PROFILE_ID=$($optionalEnv.TELNYX_MESSAGING_PROFILE_ID)",
  "SINCH_SERVICE_PLAN_ID=$($optionalEnv.SINCH_SERVICE_PLAN_ID)",
  "SINCH_API_TOKEN=$($optionalEnv.SINCH_API_TOKEN)",
  "INFOBIP_BASE_URL=$($optionalEnv.INFOBIP_BASE_URL)",
  "INFOBIP_API_KEY=$($optionalEnv.INFOBIP_API_KEY)",
  "BANDWIDTH_API_TOKEN=$($optionalEnv.BANDWIDTH_API_TOKEN)",
  "BANDWIDTH_API_SECRET=$($optionalEnv.BANDWIDTH_API_SECRET)",
  "BANDWIDTH_APPLICATION_ID=$($optionalEnv.BANDWIDTH_APPLICATION_ID)",
  "BIRD_ACCESS_KEY=$($optionalEnv.BIRD_ACCESS_KEY)",
  "BIRD_WORKSPACE_ID=$($optionalEnv.BIRD_WORKSPACE_ID)",
  "BIRD_CHANNEL_ID=$($optionalEnv.BIRD_CHANNEL_ID)",
  "AWS_REGION=$($optionalEnv.AWS_REGION)",
  "AWS_ACCESS_KEY_ID=$($optionalEnv.AWS_ACCESS_KEY_ID)",
  "AWS_SECRET_ACCESS_KEY=$($optionalEnv.AWS_SECRET_ACCESS_KEY)",
  "AWS_SNS_SENDER_ID=$($optionalEnv.AWS_SNS_SENDER_ID)",
  "AZURE_COMMUNICATION_CONNECTION_STRING=$($optionalEnv.AZURE_COMMUNICATION_CONNECTION_STRING)",
  "SMS_WEBHOOK_SECRET_VONAGE=$($optionalEnv.SMS_WEBHOOK_SECRET_VONAGE)",
  "SMS_WEBHOOK_SECRET_PLIVO=$($optionalEnv.SMS_WEBHOOK_SECRET_PLIVO)",
  "SMS_WEBHOOK_SECRET_TELNYX=$($optionalEnv.SMS_WEBHOOK_SECRET_TELNYX)",
  "SMS_WEBHOOK_SECRET_SINCH=$($optionalEnv.SMS_WEBHOOK_SECRET_SINCH)",
  "SMS_WEBHOOK_SECRET_INFOBIP=$($optionalEnv.SMS_WEBHOOK_SECRET_INFOBIP)",
  "SMS_WEBHOOK_SECRET_BANDWIDTH=$($optionalEnv.SMS_WEBHOOK_SECRET_BANDWIDTH)",
  "SMS_WEBHOOK_SECRET_BIRD=$($optionalEnv.SMS_WEBHOOK_SECRET_BIRD)",
  "SMS_WEBHOOK_SECRET_AWS_SNS=$($optionalEnv.SMS_WEBHOOK_SECRET_AWS_SNS)",
  "SMS_WEBHOOK_SECRET_AZURE_COMMUNICATION_SERVICES=$($optionalEnv.SMS_WEBHOOK_SECRET_AZURE_COMMUNICATION_SERVICES)",
  "SMTP_HOST=$($optionalEnv.SMTP_HOST)",
  "SMTP_PORT=$($optionalEnv.SMTP_PORT)",
  "SMTP_USER=$($optionalEnv.SMTP_USER)",
  "SMTP_PASSWORD=$($optionalEnv.SMTP_PASSWORD)",
  "SMTP_FROM=$($optionalEnv.SMTP_FROM)",
  "SMTP_SECURE=$($optionalEnv.SMTP_SECURE)"
) | Set-Content -LiteralPath $envPath -Encoding utf8

Write-Step "Installing dependencies, applying migrations, and building the production app"
& $pnpmCommand.Source --dir $ProjectRoot install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed." }
& $pnpmCommand.Source --dir $ProjectRoot db:migrate
if ($LASTEXITCODE -ne 0) { throw "Database migration failed." }
if ($SeedDemoData) {
  & $pnpmCommand.Source --dir $ProjectRoot db:seed
  if ($LASTEXITCODE -ne 0) { throw "Database seed failed." }
}
& $pnpmCommand.Source --dir $ProjectRoot build
if ($LASTEXITCODE -ne 0) { throw "Production build failed." }

$taskName = "PantryAssistantApp"
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$startScript = Join-Path $ProjectRoot "scripts\start-self-hosted.ps1"
$taskAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -ProjectRoot `"$ProjectRoot`" -Port $Port"
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Description "Starts the Pantry Assistant self-hosted application." -Force | Out-Null

if ($EnableLanTls) {
  $caddyDirectory = Join-Path $ProjectRoot "data\caddy"
  $caddyConfig = Join-Path $caddyDirectory "Caddyfile"
  New-Item -ItemType Directory -Force -Path $caddyDirectory | Out-Null
  @"
$LanHostname {
  tls internal
  reverse_proxy 127.0.0.1:$Port
}
"@ | Set-Content -LiteralPath $caddyConfig -Encoding utf8
  $caddyTaskAction = New-ScheduledTaskAction -Execute $caddy -Argument "run --config `"$caddyConfig`" --adapter caddyfile"
  Register-ScheduledTask -TaskName "PantryAssistantTls" -Action $caddyTaskAction -Trigger $taskTrigger -Settings $taskSettings -Description "Provides Pantry Assistant HTTPS for the private network." -Force | Out-Null
}

$backupTaskName = "PantryAssistantBackup"
$backupScript = Join-Path $ProjectRoot "scripts\backup-self-hosted.ps1"
$backupAction = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$backupScript`""
$backupTrigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $backupTaskName -Action $backupAction -Trigger $backupTrigger -Settings $backupSettings -Description "Creates an encrypted Pantry Assistant PostgreSQL backup each day." -Force | Out-Null

if ($EnableLanTls) {
  $ruleName = "Pantry Assistant HTTPS"
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -Profile Private | Out-Null
  }
}

Write-Step "Setup complete. Pantry Assistant will start automatically at sign-in and create an encrypted local backup daily."
Write-Output "Local URL: http://localhost:$Port"
if ($EnableLanTls) { Write-Output "Secure LAN URL: $appUrl"; Write-Output "Trust Caddy's local CA certificate on each approved LAN device before using the secure LAN URL." }
