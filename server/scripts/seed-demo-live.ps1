# Puts the "Shree Ganesh Traders" demo company on the LIVE app.
# Right-click -> "Run with PowerShell" (or: powershell -ExecutionPolicy Bypass -File scripts\seed-demo-live.ps1)
# You only type the passwords; nothing is saved to disk.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Read-Secret($label) {
  $s = Read-Host $label -AsSecureString
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$env:API_BASE = 'https://elev-iq-biz-flow.vercel.app'
$email = Read-Host 'Super admin email [superadmin@eleviqsfa.com]'
if ([string]::IsNullOrWhiteSpace($email)) { $email = 'superadmin@eleviqsfa.com' }
$env:PLATFORM_EMAIL = $email
$env:PLATFORM_PASSWORD = Read-Secret 'Super admin password'
$env:DEMO_ADMIN_PASSWORD = Read-Secret 'New password for the demo admin (8+ chars, A-z, 0-9, symbol)'
$env:DEMO_TEAM_PASSWORD = Read-Secret 'New password for the demo team (8+ chars, A-z, 0-9, symbol)'
$env:DEMO_EMAIL_DOMAIN = 'example.com'   # demo logins; nothing is mailed to example.com
$code = Read-Host 'Company code [SGT01]'
if (-not [string]::IsNullOrWhiteSpace($code)) { $env:DEMO_COMPANY_CODE = $code }

Write-Host "`nChecking the connection..." -ForegroundColor Cyan
$env:DRY_RUN = '1'
node scripts/seed-demo-company.mjs
if ($LASTEXITCODE -ne 0) { Read-Host 'Stopped - press Enter to close'; exit 1 }
Remove-Item Env:DRY_RUN

Write-Host "`nCreating the demo company on the live app..." -ForegroundColor Cyan
node scripts/seed-demo-company.mjs
Remove-Item Env:PLATFORM_PASSWORD, Env:DEMO_ADMIN_PASSWORD, Env:DEMO_TEAM_PASSWORD -ErrorAction SilentlyContinue
Read-Host "`nFinished - press Enter to close"
