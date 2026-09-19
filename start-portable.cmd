@echo off
setlocal
cd /d "%~dp0"
title Shiny Scenario Workshop

rem Keep the export worker on the binaries shipped beside this launcher.
set "SSV_NODE=%~dp0tools\node.exe"
set "SSV_PLAYWRIGHT=%~dp0tools\node_modules\playwright"
if exist "%~dp0tools\ffmpeg.exe" set "SSV_FFMPEG=%~dp0tools\ffmpeg.exe"
if exist "%~dp0tools\ffprobe.exe" set "SSV_FFPROBE=%~dp0tools\ffprobe.exe"
if not exist "%~dp0tools\ffmpeg.exe" if not defined SSV_FFMPEG (
    echo FFmpeg is not bundled. Background export needs a user-supplied FFmpeg
    echo and FFprobe, or a build made with -BundleOfflineRuntime after license review.
)
set "SSV_CHROMIUM="
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "SSV_CHROMIUM=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined SSV_CHROMIUM if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "SSV_CHROMIUM=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined SSV_CHROMIUM if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "SSV_CHROMIUM=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined SSV_CHROMIUM if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "SSV_CHROMIUM=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined SSV_CHROMIUM (
    echo Microsoft Edge and Google Chrome were not found. Background video
    echo export requires a compatible local browser; install one to use it.
    echo Scenario playback and translation editing can still be used.
)

set "SSV_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%SSV_POWERSHELL%" (
    echo Windows PowerShell was not found.
    echo This portable build requires Windows 10 or Windows 11.
    pause
    exit /b 1
)

"%SSV_POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-viewer.ps1"
if errorlevel 1 pause
