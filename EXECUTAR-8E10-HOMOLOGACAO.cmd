@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".scripts\8E9\EXECUTAR_8E10_HOMOLOGACAO.ps1"
echo.
pause
