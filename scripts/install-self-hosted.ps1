param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 3000,
  [switch]$SeedDemoData,
  [switch]$DisableLanAccess,
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

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json"))) { throw "Run this script from the Pantry Assistant application folder." }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw "Run Pantry Assistant setup from an elevated PowerShell window so it can create the LAN firewall rule and scheduled task." }

Write-Step "Checking Node.js and pnpm"
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "Node.js 20 or newer is required. Install the current Node.js LTS release, then run setup again." }
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer is required; found $nodeMajor." }
$pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
if (-not $pnpmCommand) { throw "pnpm is required. Install pnpm, then run setup again." }

Write-Step "Checking native PostgreSQL"
$postgresService = Get-Service -Name "postgresql-x64-18" -ErrorAction SilentlyContinue
if (-not $postgresService) { throw "Native PostgreSQL 18 was not found. Install PostgreSQL 18 as a Windows service, then run setup again." }
if ($postgresService.Status -ne "Running") { Start-Service -Name $postgresService.Name }
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$createdb = "C:\Program Files\PostgreSQL\18\bin\createdb.exe"
if (-not (Test-Path -LiteralPath $psql) -or -not (Test-Path -LiteralPath $createdb)) { throw "PostgreSQL 18 command-line tools were not found." }

$envPath = Join-Path $ProjectRoot ".env.local"
$existingAppPassword = Get-EnvValue $envPath "PANTRY_APP_PASSWORD"
$existingDatabaseUrl = Get-EnvValue $envPath "DATABASE_URL"
$adminPassword = Get-PlainSecret "Enter the PostgreSQL postgres administrator password (used only during setup)"
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
$optionalEnvNames = @("TWILIO_ACCOUNT_SID","TWILIO_AUTH_TOKEN","TWILIO_MESSAGING_SERVICE_SID","TWILIO_PHONE_NUMBER","TWILIO_WEBHOOK_BASE_URL","VONAGE_API_KEY","VONAGE_API_SECRET","PLIVO_AUTH_ID","PLIVO_AUTH_TOKEN","TELNYX_API_KEY","TELNYX_MESSAGING_PROFILE_ID","SINCH_SERVICE_PLAN_ID","SINCH_API_TOKEN","INFOBIP_BASE_URL","INFOBIP_API_KEY","BANDWIDTH_API_TOKEN","BANDWIDTH_API_SECRET","BANDWIDTH_APPLICATION_ID","BIRD_ACCESS_KEY","BIRD_WORKSPACE_ID","BIRD_CHANNEL_ID","AWS_REGION","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","AWS_SNS_SENDER_ID","AZURE_COMMUNICATION_CONNECTION_STRING","SMS_WEBHOOK_SECRET","SMTP_HOST","SMTP_PORT","SMTP_USER","SMTP_PASSWORD","SMTP_FROM","SMTP_SECURE")
$optionalEnv = @{}
foreach ($name in $optionalEnvNames) { $optionalEnv[$name] = Get-EnvValue $envPath $name }
$encodedPassword = [Uri]::EscapeDataString($appPassword)
$databaseUrl = if ($existingDatabaseUrl) { $existingDatabaseUrl } else { "postgresql://pantry_app:$encodedPassword@127.0.0.1:5432/food_pantry_dev" }
$testDatabaseUrl = "postgresql://pantry_app:$encodedPassword@127.0.0.1:5432/food_pantry_test"
$hostName = [System.Net.Dns]::GetHostName()
$appUrl = if ($DisableLanAccess) { "http://localhost:$Port" } else { "http://$hostName`:$Port" }
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
  "SMS_WEBHOOK_SECRET=$($optionalEnv.SMS_WEBHOOK_SECRET)",
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

if (-not $DisableLanAccess) {
  $ruleName = "Pantry Assistant TCP $Port"
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
  }
}

Write-Step "Setup complete. Pantry Assistant will start automatically at sign-in."
Write-Output "Local URL: http://localhost:$Port"
if (-not $DisableLanAccess) { Write-Output "LAN URL: $appUrl" }
