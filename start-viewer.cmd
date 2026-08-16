@echo off
setlocal
title ShinyScenarioViewer

where py >nul 2>nul
if not errorlevel 1 goto use_py

where python >nul 2>nul
if not errorlevel 1 goto use_python

echo Python was not found. Install Python or add it to PATH first.
pause
exit /b 1

:use_py
py "%~dp0serve-viewer.py"
goto finished

:use_python
python "%~dp0serve-viewer.py"

:finished
if errorlevel 1 pause
