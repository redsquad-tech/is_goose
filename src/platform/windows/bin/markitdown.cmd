@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
"%SCRIPT_DIR%python-runtime\python.exe" -m markitdown %*
exit /b %ERRORLEVEL%
