@echo off
title Laya Server
rem Bo comment dong duoi de bat buoc token khi goi API:
rem set LAYA_API_KEY=doi-thanh-chuoi-bi-mat

echo Dang khoi dong Laya tai http://localhost:8000  (docs: http://localhost:8000/docs)
echo Nhan Ctrl+C de dung server.
"%USERPROFILE%\.local\bin\laya-serve.exe"
pause
