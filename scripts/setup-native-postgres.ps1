$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$settingsPath = Join-Path $projectRoot ".env.setup.local"
$environmentPath = Join-Path $projectRoot ".env.local"
$postgresBin = "C:\Program Files\PostgreSQL\18\bin"
$psql = Join-Path $postgresBin "psql.exe"
$createdb = Join-Path $postgresBin "createdb.exe"

if (-not (Test-Path $psql) -or -not (Test-Path $settingsPath)) {
  throw "PostgreSQL 18 or the ignored local setup credentials are missing."
}

$settings = @{}
Get-Content $settingsPath | ForEach-Object {
  $parts = $_ -split "=", 2
  if ($parts.Count -eq 2) { $settings[$parts[0]] = $parts[1] }
}

if (-not $settings.POSTGRES_ADMIN_PASSWORD -or -not $settings.PANTRY_APP_PASSWORD) {
  throw "The ignored local setup credentials are incomplete."
}

function New-LocalSecret {
  $bytes = New-Object byte[] 48
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $generator.GetBytes($bytes)
  $generator.Dispose()
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "A").Replace("/", "b")
}

$env:PGPASSWORD = $settings.POSTGRES_ADMIN_PASSWORD
try {
  $roleExists = & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -tAc "select 1 from pg_roles where rolname = 'pantry_app'"
  if (-not $roleExists) {
    $roleSql = "create role pantry_app login nosuperuser nocreatedb nocreaterole noinherit password '$($settings.PANTRY_APP_PASSWORD)';"
    $roleSql | & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1
  }

  foreach ($database in @("food_pantry_dev", "food_pantry_test")) {
    $exists = & $psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -tAc "select 1 from pg_database where datname = '$database'"
    if (-not $exists) {
      & $createdb -h 127.0.0.1 -p 5432 -U postgres -O pantry_app $database
    }
  }
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if (-not $settings.BETTER_AUTH_SECRET) {
  $settings.BETTER_AUTH_SECRET = New-LocalSecret
  Add-Content -LiteralPath $settingsPath -Value "BETTER_AUTH_SECRET=$($settings.BETTER_AUTH_SECRET)"
}
if (-not $settings.SEED_USER_PASSWORD) {
  $settings.SEED_USER_PASSWORD = New-LocalSecret
  Add-Content -LiteralPath $settingsPath -Value "SEED_USER_PASSWORD=$($settings.SEED_USER_PASSWORD)"
}

$encodedPassword = [Uri]::EscapeDataString($settings.PANTRY_APP_PASSWORD)
$developmentUrl = "postgresql://pantry_app:$encodedPassword@127.0.0.1:5432/food_pantry_dev"
$testUrl = "postgresql://pantry_app:$encodedPassword@127.0.0.1:5432/food_pantry_test"
$environment = @(
  "DATABASE_URL=$developmentUrl"
  "TEST_DATABASE_URL=$testUrl"
  "BETTER_AUTH_SECRET=$($settings.BETTER_AUTH_SECRET)"
  "BETTER_AUTH_URL=http://localhost:3000"
  "APP_URL=http://localhost:3000"
  "SEED_USER_PASSWORD=$($settings.SEED_USER_PASSWORD)"
)
[IO.File]::WriteAllLines($environmentPath, $environment, [Text.UTF8Encoding]::new($false))

$env:PGPASSWORD = $settings.PANTRY_APP_PASSWORD
try {
  foreach ($database in @("food_pantry_dev", "food_pantry_test")) {
    $identity = & $psql -h 127.0.0.1 -p 5432 -U pantry_app -d $database -v ON_ERROR_STOP=1 -tAc "select current_user || ':' || current_database()"
    Write-Output "verified:$identity"
  }
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
