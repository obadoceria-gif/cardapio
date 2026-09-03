@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".scripts\8E9\EXECUTAR_8E9F_PUBLICACAO.ps1"
if errorlevel 1 pause
