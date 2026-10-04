# setup_workflow.ps1 - cai workflow 5 buoc (subagent wf-* + lenh /wf + hook chon model bang Laya) vao mot repo.
#   powershell -ExecutionPolicy Bypass -File .\setup_workflow.ps1 -Target D:\path\to\repo
#   ... -Remove   de go
# Che do chon model dat bang bien moi truong TRUOC KHI mo Claude Code:  $env:LAYA_STEP_MODE = "laya" | "static" | "off"
# (mac dinh laya). Che do laya can laya-serve dang chay o cong 8000 (khong co thi hook bo qua, subagent dung model mac dinh).
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [switch]$Remove
)
$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target = (Resolve-Path $Target).Path
$Claude = Join-Path $Target ".claude"
$Settings = Join-Path $Claude "settings.local.json"
$Steps = "explore", "plan", "implement", "verify", "review"

# python de chay hook va script gop settings: hook chi dung thu vien chuan nen python nao cung duoc
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) {
    $uvDir = (uv tool dir 2>$null)
    if ($uvDir) { $cand = Join-Path $uvDir "laya\Scripts\python.exe"; if (Test-Path $cand) { $py = $cand } }
}
if (-not $py) { throw "Khong tim thay python (can cho hook). Cai Python hoac cai Laya bang uv truoc." }

if ($Remove) {
    foreach ($s in $Steps) { Remove-Item (Join-Path $Claude "agents\wf-$s.md") -ErrorAction SilentlyContinue }
    Remove-Item (Join-Path $Claude "commands\wf.md") -ErrorAction SilentlyContinue
    if (Test-Path $Settings) {
        & $py (Join-Path $Here "settings_merge.py") $Settings remove
        if ($LASTEXITCODE -ne 0) { throw "Khong go duoc hook khoi $Settings" }
    }
    Write-Host "Da go workflow khoi $Target"
    return
}

New-Item -ItemType Directory -Force (Join-Path $Claude "agents"), (Join-Path $Claude "commands") | Out-Null
foreach ($s in $Steps) { Copy-Item (Join-Path $Here "agents\wf-$s.md") (Join-Path $Claude "agents\wf-$s.md") -Force }
Copy-Item (Join-Path $Here "commands\wf.md") (Join-Path $Claude "commands\wf.md") -Force
& $py (Join-Path $Here "settings_merge.py") $Settings add $py (Join-Path $Here "hooks\laya_step_router.py")
if ($LASTEXITCODE -ne 0) { throw "Khong cap nhat duoc $Settings (xem loi o tren). Agents va lenh /wf da chep, hook thi chua." }

Write-Host @"

Da cai vao $Target
  agents:   .claude\agents\wf-{explore,plan,implement,verify,review}.md
  lenh:     /wf <mo ta task>
  hook:     .claude\settings.local.json  (PreToolUse, Agent|Task -> laya_step_router.py)
  log:      $Here\hooks\step_decisions.jsonl
Che do:  `$env:LAYA_STEP_MODE = "laya"`  (hoac static / off) roi mo claude trong repo do.
Gỡ:      .\setup_workflow.ps1 -Target $Target -Remove
"@
