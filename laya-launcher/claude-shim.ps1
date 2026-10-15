# claude-shim.ps1 - de lenh `claude` bang Laya shim. Nap trong $PROFILE:  . D:\XionTechs\Laya-router-research\laya-launcher\claude-shim.ps1
# `claude-full` = claude nguyen ban. Go shim: xoa dong tren khoi $PROFILE.
$script:LayaShimDir = $PSScriptRoot
$script:LayaPython = 'C:\Users\ADMIN\AppData\Roaming\uv\tools\laya\Scripts\python.exe'   # chi can stdlib, python nao cung duoc
$script:ClaudeReal = 'C:\Users\ADMIN\AppData\Roaming\npm\claude.cmd'

function claude {
    $env:LAYA_CLAUDE_BIN = $script:ClaudeReal
    $env:HF_HOME = if ($env:HF_HOME) { $env:HF_HOME } else { 'E:\hf-cache' }
    $env:PYTHONIOENCODING = 'utf-8'
    & $script:LayaPython (Join-Path $script:LayaShimDir 'laya_shim.py') @args
    $global:LASTEXITCODE = $LASTEXITCODE
}

function claude-full { & $script:ClaudeReal @args }
