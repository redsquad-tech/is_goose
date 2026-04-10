@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%SCRIPT_DIR%ms-playwright"
set "PATCHRIGHT_BROWSERS_PATH=%SCRIPT_DIR%ms-playwright"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
"%SCRIPT_DIR%python-runtime\python.exe" -m crawl4ai.cli %*
exit /b %ERRORLEVEL%
