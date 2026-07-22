param(
  [string]$PackagePath = "",
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [switch]$Rollback,
  [switch]$SkipBackup
)

$ErrorActionPreference = "Stop"
$managedPaths = @(".next", "public", "src", "scripts", "drizzle", "docs", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next.config.ts", ".env.example", "README.md", "LICENSE")
$rollbackRoot = Join-Path $ProjectRoot "data\update-rollbacks"

function Copy-ManagedFiles([string]$Source, [string]$Destination) {
  foreach ($item in $managedPaths) {
    $sourcePath = Join-Path $Source $item
    if (-not (Test-Path -LiteralPath $sourcePath)) { continue }
    $destinationPath = Join-Path $Destination $item
    $parent = Split-Path -Parent $destinationPath
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse -Force
  }
}

function Remove-ManagedFiles([string]$Root) {
  foreach ($item in $managedPaths) {
    $path = Join-Path $Root $item
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot ".env.local"))) { throw "This is not a configured Pantry Assistant installation." }
if (-not (Get-Command pnpm.cmd -ErrorAction SilentlyContinue)) { throw "pnpm is required to update Pantry Assistant." }
New-Item -ItemType Directory -Force -Path $rollbackRoot | Out-Null

if ($Rollback) {
  $latest = Get-ChildItem -LiteralPath $rollbackRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw "No application rollback snapshot is available." }
  Remove-ManagedFiles $ProjectRoot
  Copy-ManagedFiles $latest.FullName $ProjectRoot
  & pnpm.cmd --dir $ProjectRoot install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "Rollback files were restored but dependency installation failed." }
  & pnpm.cmd --dir $ProjectRoot build
  if ($LASTEXITCODE -ne 0) { throw "Rollback files were restored but the previous application could not build." }
  Write-Output "Application rollback complete. Database migrations are never reversed automatically; use a forward corrective migration or a separate recovery database."
  exit 0
}

if (-not (Test-Path -LiteralPath $PackagePath)) { throw "Release package not found: $PackagePath" }
if ([IO.Path]::GetExtension($PackagePath).ToLowerInvariant() -ne ".zip") { throw "Updates must use an official Pantry Assistant Windows ZIP package." }

if (-not $SkipBackup) {
  & (Join-Path $ProjectRoot "scripts\backup-self-hosted.ps1")
  if ($LASTEXITCODE -ne 0) { throw "Update stopped because the encrypted backup did not complete." }
}

$staging = Join-Path $env:TEMP ("PantryAssistant-update-" + [Guid]::NewGuid().ToString("N"))
$rollback = Join-Path $rollbackRoot (Get-Date -Format "yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $staging, $rollback | Out-Null
try {
  Expand-Archive -LiteralPath $PackagePath -DestinationPath $staging -Force
  if (-not (Test-Path -LiteralPath (Join-Path $staging "package.json"))) { throw "The ZIP package is missing Pantry Assistant application files." }
  Copy-ManagedFiles $ProjectRoot $rollback
  Remove-ManagedFiles $ProjectRoot
  Copy-ManagedFiles $staging $ProjectRoot
  & pnpm.cmd --dir $ProjectRoot install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }
  & pnpm.cmd --dir $ProjectRoot build
  if ($LASTEXITCODE -ne 0) { throw "Production build failed." }
} catch {
  Remove-ManagedFiles $ProjectRoot
  Copy-ManagedFiles $rollback $ProjectRoot
  & pnpm.cmd --dir $ProjectRoot install --frozen-lockfile
  & pnpm.cmd --dir $ProjectRoot build
  throw "Update files were rolled back because validation failed. The prior application files are restored; database migrations were not run. Details: $($_.Exception.Message)"
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}

& pnpm.cmd --dir $ProjectRoot db:migrate
if ($LASTEXITCODE -ne 0) { throw "The application update built successfully, but database migration failed. Do not attempt an application rollback against a partially migrated database; preserve the error and use the encrypted backup only in a separate recovery database." }

$appTask = Get-ScheduledTask -TaskName "PantryAssistantApp" -ErrorAction SilentlyContinue
if ($appTask) {
  if ($appTask.State -eq "Running") { Stop-ScheduledTask -TaskName "PantryAssistantApp" -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
  Start-ScheduledTask -TaskName "PantryAssistantApp" -ErrorAction SilentlyContinue
}

Write-Output "Pantry Assistant update complete. A rollback snapshot of the prior application is stored in: $rollback"
Write-Output "To restore the prior application files only: pnpm selfhost:update -- -Rollback"
