@echo off
setlocal
cd /d "%~dp0"
title Shiny Scenario Workshop

set "SSV_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%SSV_POWERSHELL%" (
    echo Windows PowerShell was not found.
    echo This portable build requires Windows 10 or Windows 11.
    pause
    exit /b 1
)

"%SSV_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-viewer.ps1"
if errorlevel 1 pause

