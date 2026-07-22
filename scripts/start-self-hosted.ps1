param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 3000,
  [string]$Host = "127.0.0.1"
)

$ErrorActionPreference = "Stop"
$logDirectory = Join-Path $ProjectRoot "data\logs"
$logPath = Join-Path $logDirectory "pantry-assistant.log"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
Set-Location -LiteralPath $ProjectRoot

$pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
& $pnpm --dir $ProjectRoot exec next start --hostname $Host --port $Port *>> $logPath
exit $LASTEXITCODE
