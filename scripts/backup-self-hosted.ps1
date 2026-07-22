param([string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) "backups"))

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"
if (-not (Test-Path -LiteralPath $envPath)) { throw ".env.local is missing. Run self-hosted setup first." }
$line = Get-Content -LiteralPath $envPath | Where-Object { $_ -like "DATABASE_URL=*" } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL is missing." }
$databaseUrl = $line.Substring(13).Trim('"')
$uri = [Uri]$databaseUrl
if ($uri.Host -notin @("localhost", "127.0.0.1") -or $uri.AbsolutePath.TrimStart('/') -ne "food_pantry_dev") { throw "Backups only accept the local food_pantry_dev database." }
$password = [Uri]::UnescapeDataString($uri.UserInfo.Split(':', 2)[1])
$user = $uri.UserInfo.Split(':', 2)[0]
$hostName = $uri.Host
$portNumber = $uri.Port
$pgDump = "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe"
if (-not (Test-Path -LiteralPath $pgDump)) { throw "PostgreSQL 18 pg_dump.exe was not found." }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$path = Join-Path $OutputDirectory ("pantry-assistant-{0}.dump" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$env:PGPASSWORD = $password
try { & $pgDump --format=custom --file=$path --host=$hostName --port=$portNumber --username=$user --dbname=food_pantry_dev --no-owner --no-acl } finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
if ($LASTEXITCODE -ne 0) { throw "Database backup failed." }
& cipher.exe /e /a $path | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Database backup was created but Windows EFS encryption could not be applied." }
Write-Output "Encrypted backup created: $path"
