param([Parameter(Mandatory=$true)][string]$BackupFile)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"
if (-not (Test-Path -LiteralPath $BackupFile)) { throw "Backup file not found." }
$line = Get-Content -LiteralPath $envPath | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL is missing." }
$databaseUrl = $line.Substring(13).Trim('"')
$uri = [Uri]$databaseUrl
if ($uri.Host -notin @("localhost", "127.0.0.1") -or $uri.AbsolutePath.TrimStart('/') -ne "food_pantry_dev") { throw "Restore only accepts the local food_pantry_dev database." }
$confirmation = Read-Host "This replaces food_pantry_dev. Type RESTORE PANTRY ASSISTANT to continue"
if ($confirmation -cne "RESTORE PANTRY ASSISTANT") { throw "Restore cancelled." }
$password = [Uri]::UnescapeDataString($uri.UserInfo.Split(':', 2)[1])
$user = $uri.UserInfo.Split(':', 2)[0]
$hostName = $uri.Host
$portNumber = $uri.Port
$pgRestore = "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe"
if (-not (Test-Path -LiteralPath $pgRestore)) { throw "PostgreSQL 18 pg_restore.exe was not found." }
$env:PGPASSWORD = $password
try { & $pgRestore --clean --if-exists --no-owner --no-acl --host=$hostName --port=$portNumber --username=$user --dbname=food_pantry_dev $BackupFile } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
if ($LASTEXITCODE -ne 0) { throw "Database restore failed." }
Write-Output "Restore complete. Run pnpm db:status to verify migrations."
