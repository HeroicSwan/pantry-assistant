param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "package.json"))) { throw "Run this wizard from the Pantry Assistant application folder." }
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  [System.Windows.Forms.MessageBox]::Show("Restart this wizard from an elevated PowerShell window so it can install prerequisites, create the firewall rule, and register startup tasks.", "Pantry Assistant setup", "OK", "Warning") | Out-Null
  exit 1
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Pantry Assistant setup"
$form.Size = New-Object System.Drawing.Size(610, 510)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = "Set up Pantry Assistant"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(28, 24)
$title.AutoSize = $true
$form.Controls.Add($title)

$intro = New-Object System.Windows.Forms.Label
$intro.Text = "This creates the local database, protected application settings, Windows startup task, daily encrypted backups, and an optional private-network firewall rule."
$intro.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$intro.Location = New-Object System.Drawing.Point(30, 68)
$intro.Size = New-Object System.Drawing.Size(540, 44)
$form.Controls.Add($intro)

function Add-Check([string]$Text, [int]$Top, [bool]$Checked) {
  $check = New-Object System.Windows.Forms.CheckBox
  $check.Text = $Text
  $check.Font = New-Object System.Drawing.Font("Segoe UI", 10)
  $check.Location = New-Object System.Drawing.Point(32, $Top)
  $check.Size = New-Object System.Drawing.Size(530, 28)
  $check.Checked = $Checked
  $form.Controls.Add($check)
  return $check
}

$bootstrap = Add-Check "Install missing Node.js, pnpm, and PostgreSQL prerequisites with WinGet" 132 $true
$lan = Add-Check "Enable secure HTTPS access for approved devices on this private network" 172 $false
$seed = Add-Check "Load fictional training/demo data (never use for a real pantry)" 212 $false

$assistantLabel = New-Object System.Windows.Forms.Label
$assistantLabel.Text = "Local assistant"
$assistantLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$assistantLabel.Location = New-Object System.Drawing.Point(32, 258)
$assistantLabel.AutoSize = $true
$form.Controls.Add($assistantLabel)
$assistant = New-Object System.Windows.Forms.ComboBox
$assistant.DropDownStyle = "DropDownList"
$assistant.Items.AddRange([string[]]@("ollama", "disabled"))
$assistant.SelectedIndex = 0
$assistant.Location = New-Object System.Drawing.Point(170, 255)
$assistant.Size = New-Object System.Drawing.Size(180, 28)
$form.Controls.Add($assistant)

$passwordLabel = New-Object System.Windows.Forms.Label
$passwordLabel.Text = "PostgreSQL administrator password"
$passwordLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$passwordLabel.Location = New-Object System.Drawing.Point(32, 303)
$passwordLabel.AutoSize = $true
$form.Controls.Add($passwordLabel)
$password = New-Object System.Windows.Forms.TextBox
$password.UseSystemPasswordChar = $true
$password.Location = New-Object System.Drawing.Point(32, 330)
$password.Size = New-Object System.Drawing.Size(430, 28)
$form.Controls.Add($password)
$passwordHint = New-Object System.Windows.Forms.Label
$passwordHint.Text = "Used only while setup creates the restricted Pantry Assistant database account. It is not saved."
$passwordHint.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$passwordHint.ForeColor = [System.Drawing.Color]::DimGray
$passwordHint.Location = New-Object System.Drawing.Point(32, 363)
$passwordHint.Size = New-Object System.Drawing.Size(500, 30)
$form.Controls.Add($passwordHint)

$install = New-Object System.Windows.Forms.Button
$install.Text = "Begin setup"
$install.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$install.Location = New-Object System.Drawing.Point(350, 414)
$install.Size = New-Object System.Drawing.Size(120, 36)
$install.Add_Click({
  if ([string]::IsNullOrWhiteSpace($password.Text)) {
    [System.Windows.Forms.MessageBox]::Show("Enter the PostgreSQL administrator password before continuing.", "Pantry Assistant setup", "OK", "Warning") | Out-Null
    return
  }
  $form.Tag = [PSCustomObject]@{ Bootstrap = $bootstrap.Checked; Lan = $lan.Checked; Seed = $seed.Checked; Assistant = [string]$assistant.SelectedItem; Password = (ConvertTo-SecureString $password.Text -AsPlainText -Force) }
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})
$form.Controls.Add($install)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.Location = New-Object System.Drawing.Point(478, 414)
$cancel.Size = New-Object System.Drawing.Size(80, 36)
$cancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
$form.Controls.Add($cancel)

if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
$selection = $form.Tag
Write-Host "[Pantry Assistant] Setup is running in this window. It may open the official PostgreSQL installer when PostgreSQL is not installed." -ForegroundColor Cyan
$arguments = @{ ProjectRoot = $ProjectRoot; AssistantProvider = $selection.Assistant; PostgresAdminPassword = $selection.Password }
if ($selection.Bootstrap) { $arguments.BootstrapPrerequisites = $true }
if ($selection.Seed) { $arguments.SeedDemoData = $true }
if ($selection.Lan) { $arguments.EnableLanTls = $true } else { $arguments.DisableLanAccess = $true }
& (Join-Path $ProjectRoot "scripts\install-self-hosted.ps1") @arguments
if ($LASTEXITCODE -ne 0) { throw "Pantry Assistant setup did not complete." }
[System.Windows.Forms.MessageBox]::Show("Pantry Assistant setup is complete. Use the local URL printed in this window to create the first pantry account.", "Pantry Assistant setup", "OK", "Information") | Out-Null
