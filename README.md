# Laya self-host - goi cai dat cho may dev Windows

## Yeu cau
- Windows 10/11, co internet (tai ~3 GB lan dau)
- Khong can cai san Python: script tu cai `uv` va Python 3.12 rieng, khong dung toi Python cua may
- GPU NVIDIA la tuy chon (`-Device cuda`); mac dinh chay CPU

## Cai dat
Giai nen, mo PowerShell trong thu muc nay, chay:

    powershell -ExecutionPolicy Bypass -File .\install-laya.ps1

Tuy chon:

    -HfHome D:\hf-cache   # noi luu model (mac dinh D:\hf-cache; doi neu khong co o D)
    -Device cpu           # hoac cuda
    -SkipMcp              # khong dang ky MCP voi Claude Code

Script ghim `laya==0.3.21` va ap dung ban va `serve.py` (them `POST /v1/systemone/form`
de test bang form tren Swagger). Cac buoc deu chay lai duoc, khong hong neu chay 2 lan.

## Chay
Mo PowerShell MOI (de nhan bien moi truong), roi:

    laya-serve

hoac bam dup `start-laya.bat`. API: `POST http://localhost:8000/v1/systemone`,
Swagger: http://localhost:8000/docs

## Go cai

    uv tool uninstall laya
    claude mcp remove laya -s user      # neu da dang ky MCP
    Remove-Item -Recurse D:\hf-cache    # model

## Noi dung goi
- `install-laya.ps1`  script cai dat
- `serve.py`          ban va cua laya/serve.py (laya 0.3.21)
- `start-laya.bat`    chay server bang 1 cu click
