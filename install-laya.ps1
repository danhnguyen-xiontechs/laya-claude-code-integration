# install-laya.ps1 - Cai Laya decision engine (self-host, CPU/GPU) tren may dev Windows.
# Chay:  powershell -ExecutionPolicy Bypass -File .\install-laya.ps1 [-HfHome D:\hf-cache] [-Device cpu] [-SkipMcp]
param(
    [string]$HfHome = "D:\hf-cache",   # noi luu model (~2.2 GB); doi sang o C neu may khong co o D
    [string]$Device = "cpu",           # cpu | cuda
    [switch]$SkipMcp                   # bo qua buoc dang ky MCP voi Claude Code
)
$ErrorActionPreference = "Stop"
$LayaVersion = "0.3.21"               # ghim phien ban de moi may giong nhau
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bin  = "$env:USERPROFILE\.local\bin"

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }

# 1. uv (trinh quan ly Python) -------------------------------------------------
Step "Kiem tra uv"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host "Chua co uv, dang cai..."
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:Path = "$Bin;$env:Path"
}
uv --version

# 2. Laya + extras serve, mcp ---------------------------------------------------
Step "Cai laya==$LayaVersion (serve + mcp). Khoang 0.8 GB, co the mat vai phut"
uv tool install --python 3.12 --force "laya[serve,mcp]==$LayaVersion"
$Bin = (uv tool dir --bin).Trim()
$ToolDir = (uv tool dir).Trim()
$env:Path = "$Bin;$env:Path"

# 3. Va serve.py: them route /v1/systemone/form de test tren Swagger ----------
Step "Ap dung ban va serve.py (Swagger form)"
$ToolPy = "$ToolDir\laya\Scripts\python.exe"
$ServePath = & $ToolPy -c "import laya.serve; print(laya.serve.__file__)"
$Ver = & $ToolPy -c "import importlib.metadata as m; print(m.version('laya'))"
if ($Ver -ne $LayaVersion) { throw "Phien ban laya cai duoc ($Ver) khac ban va ($LayaVersion); khong ap dung ban va." }
Copy-Item "$Here\serve.py" $ServePath -Force
& $ToolPy -c "from laya.serve import create_app; a=create_app(router=object()); assert '/v1/systemone/form' in a.openapi()['paths']; print('serve.py OK')"

# 4. Bien moi truong -----------------------------------------------------------
Step "Dat bien moi truong (HF_HOME=$HfHome, LAYA_DEVICE=$Device)"
New-Item -ItemType Directory -Force $HfHome | Out-Null
setx HF_HOME $HfHome | Out-Null
setx LAYA_DEVICE $Device | Out-Null
setx HF_HUB_DISABLE_SYMLINKS_WARNING 1 | Out-Null
$env:HF_HOME = $HfHome; $env:LAYA_DEVICE = $Device; $env:HF_HUB_DISABLE_SYMLINKS_WARNING = "1"

# 5. Tai san model de lan chay dau khong phai cho ------------------------------
Step "Tai model convaiinnovations/laya vao $HfHome (~2.2 GB)"
& $ToolPy -c "from huggingface_hub import snapshot_download; p=snapshot_download('convaiinnovations/laya'); print('model tai xong:', p)"

# 6. Kiem tra nhanh: nap model va du doan 1 cau --------------------------------
Step "Chay thu 1 du doan (co the mat 10-30 giay)"
& $ToolPy -c @"
from laya import Router
r = Router()
res = r.predict('billed twice, refund please', {'dept': {'type':'choice','instructions':'which team?','criteria':{'billing':'refunds','tech':'bugs'}}})
print('predict OK ->', res['answers']['dept']['choice'], res['answers']['dept']['probabilities'])
"@

# 7. MCP cho Claude Code (tuy chon) --------------------------------------------
if (-not $SkipMcp) {
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        Step "Dang ky MCP server 'laya' voi Claude Code (scope user)"
        claude mcp remove laya -s user 2>$null | Out-Null
        claude mcp add laya -s user -e LAYA_DEVICE=$Device -e LAYA_MODELS=english -- "$Bin\laya-mcp-server.exe"
    } else {
        Write-Host "Khong thay lenh 'claude', bo qua buoc dang ky MCP." -ForegroundColor Yellow
    }
}

Write-Host @"

=== CAI DAT XONG ===
Chay server:   mo PowerShell MOI (de nhan bien moi truong) roi go:  laya-serve
               hoac bam dup file start-laya.bat
API:           http://localhost:8000/v1/systemone   (Swagger: http://localhost:8000/docs)
Model:         $HfHome
Go cai:        uv tool uninstall laya
"@ -ForegroundColor Green
