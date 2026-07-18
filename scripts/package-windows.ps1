param([string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist"))

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageName = "PantryAssistant-windows-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")
$stagingRoot = Join-Path $env:TEMP $packageName
$archivePath = Join-Path $OutputDirectory "$packageName.zip"

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
try {
  & (Get-Command pnpm.cmd -ErrorAction Stop).Source --dir $projectRoot build
  if ($LASTEXITCODE -ne 0) { throw "Production build failed; package was not created." }
  $items = @(".next", "public", "src", "scripts", "drizzle", "docs\27-self-hosted-windows-installation.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "next.config.ts", ".env.example", "README.md", "LICENSE")
  foreach ($item in $items) {
    $source = Join-Path $projectRoot $item
    if (-not (Test-Path -LiteralPath $source)) { throw "Required release file is missing: $item" }
    $destination = Join-Path $stagingRoot $item
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    if ($item -eq ".next") {
      Remove-Item -LiteralPath (Join-Path $destination "cache") -Recurse -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath (Join-Path $destination "dev") -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $archivePath -CompressionLevel Optimal -Force
  Write-Output "Release package created: $archivePath"
} finally {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
}
