<#
  Launches a browser for one ESS role with remote debugging on port 9222, so the
  chrome-devtools MCP (registered with --browserUrl=http://127.0.0.1:9222) can attach.
  Each role keeps its own persistent profile, so a Microsoft sign-in survives between runs.
  Roles map to accounts in ../roles.json; with no role given, roles.json "default" is used.

  Why not the user's own Edge profile: Chrome/Edge 136+ ignore --remote-debugging-port on the
  browser's default user-data-dir, and an Edge that is already running would swallow the launch
  anyway. So each role gets a dedicated profile that is signed in once with the role's account.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File launch-role.ps1 [role] [url]
    powershell -NoProfile -ExecutionPolicy Bypass -File launch-role.ps1 status
    powershell -NoProfile -ExecutionPolicy Bypass -File launch-role.ps1 stop

  Only one role can own port 9222 at a time: launching a different role stops the current one.
#>
param(
  [Parameter(Position = 0)][string]$Role,
  [Parameter(Position = 1)][string]$Url = 'about:blank'
)

$ErrorActionPreference = 'Stop'
$Port = 9222
$ProfileRoot = Join-Path $HOME '.ess-web-test\profiles'
$Marker = Join-Path $HOME '.ess-web-test\active-role.txt'
$RolesFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'roles.json'
$Roles = if (Test-Path $RolesFile) { Get-Content $RolesFile -Raw | ConvertFrom-Json } else { $null }

function Get-RoleAccount([string]$r) {
  if ($r -and $Roles -and $Roles.roles.$r) { return $Roles.roles.$r.account }
  return $null
}

# Account the browser profile itself is signed in with (browser sign-in, not the web app).
function Get-ProfileAccount([string]$dir) {
  $ls = Join-Path $dir 'Local State'
  if (-not (Test-Path $ls)) { return $null }
  try {
    $cache = (Get-Content $ls -Raw | ConvertFrom-Json).profile.info_cache
    return ($cache.PSObject.Properties | ForEach-Object { $_.Value.user_name } | Where-Object { $_ } | Select-Object -First 1)
  } catch { return $null }
}

function Get-BrowserPath {
  # Edge first: the user works in Edge with the company account.
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $candidates += Get-ChildItem "$env:LOCALAPPDATA\ms-playwright\chromium-*\chrome-win64\chrome.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | ForEach-Object FullName
  foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { return $p } }
  throw 'No Edge, Chrome or Playwright Chromium found. Install one, or run: playwright-cli install-browser chromium'
}

function Get-DebugInfo {
  try { return Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 } catch { return $null }
}

function Stop-RoleBrowser {
  # Only stops browsers started with one of our role profiles — never the user's normal browser.
  $pattern = [regex]::Escape($ProfileRoot)
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
    Where-Object { $_.CommandLine -match $pattern } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Remove-Item $Marker -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

switch ($Role) {
  'status' {
    $info = Get-DebugInfo
    $active = if (Test-Path $Marker) { Get-Content $Marker } else { $null }
    $acct = Get-RoleAccount $active
    if ($info) { "UP   port $Port | $($info.Browser) | role: $active | account: $acct" } else { "DOWN port $Port | role: $active" }
    return
  }
  'stop' { Stop-RoleBrowser; 'stopped'; return }
}

if (-not $Role) { $Role = if ($Roles -and $Roles.default) { $Roles.default } else { 'default' } }
if ($Role -notmatch '^[a-z0-9-]+$') { throw "Role must be lowercase letters/digits/dashes, got '$Role'" }
$account = Get-RoleAccount $Role
$accountText = if ($account) { $account } else { '(not mapped in roles.json)' }

$current = if (Test-Path $Marker) { Get-Content $Marker } else { $null }
if ((Get-DebugInfo) -and $current -eq $Role) {
  "ALREADY UP role=$Role | account=$accountText | port $Port (navigate with the MCP)"
  return
}
if (Get-DebugInfo) {
  if (-not $current) { throw "Port $Port is used by a browser this script did not start. Close it, then retry." }
  Stop-RoleBrowser
}

$browser = Get-BrowserPath
$profileDir = Join-Path $ProfileRoot $Role
$firstRun = -not (Test-Path (Join-Path $profileDir 'Local State'))
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$browserArgs = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=`"$profileDir`"",
  '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900',
  $Url
)
Start-Process -FilePath $browser -ArgumentList $browserArgs | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $Marker) | Out-Null
Set-Content -Path $Marker -Value $Role

for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  if (Get-DebugInfo) {
    "UP role=$Role | account=$accountText | $(Split-Path $browser -Leaf) | profile $profileDir"
    if ($firstRun) {
      "FIRST RUN: this profile has never signed in. Ask the user to sign in as $accountText in the opened window " +
      "(the ESS Microsoft sign-in; optionally also edge://settings/profiles to sign the browser profile in for SSO). Never type the password."
    } else {
      $pa = Get-ProfileAccount $profileDir
      if ($pa -and $account -and $pa -ne $account) {
        "WARNING: browser profile is signed in as $pa, expected $account. Ask the user before continuing."
      }
    }
    return
  }
}
throw "Browser started but port $Port did not open within 10s."
