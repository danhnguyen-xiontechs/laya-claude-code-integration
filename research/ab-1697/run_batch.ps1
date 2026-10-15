# 5 vong x 4 cau hinh, xen ke de giam nhieu theo thoi gian
$env:HF_HOME = 'E:\hf-cache'; $env:PYTHONIOENCODING = 'utf-8'
Set-Location $PSScriptRoot
$py = 'C:\Users\ADMIN\AppData\Roaming\uv\tools\laya\Scripts\python.exe'
foreach ($i in 1..5) {
    foreach ($c in 'plain', 'launcher', 'launcher-gate', 'mcp') {
        if (Test-Path "runs\$c-$i\meta.json") { continue }  # da xong
        & $py run_ab.py --config $c --run $i 2>&1 | Select-Object -Last 1
    }
}
& $py compare.py | Select-Object -Last 12
