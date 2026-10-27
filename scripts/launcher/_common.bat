@echo off
REM ===========================================================================
REM  scripts\launcher\_common.bat
REM  Sets shared variables only. Contains NO callable labels, because batch
REM  labels are file-scoped: `call :label` cannot reach into another file.
REM  Callable helpers are separate .bat files in this directory.
REM ===========================================================================

set "ATLAS_ROOT=%~dp0..\.."
pushd "%ATLAS_ROOT%" >nul 2>&1
set "ATLAS_ROOT=%CD%"
popd >nul 2>&1

if "%ATLAS_BACKEND_PORT%"=="" set "ATLAS_BACKEND_PORT=8471"
if "%ATLAS_WEB_PORT%"=="" set "ATLAS_WEB_PORT=3471"
if "%ATLAS_BACKEND_URL%"=="" set "ATLAS_BACKEND_URL=http://127.0.0.1:%ATLAS_BACKEND_PORT%"

set "ATLAS_VENV_PY=%ATLAS_ROOT%\.venv\Scripts\python.exe"
set "ATLAS_LOGS=%ATLAS_ROOT%\logs"
if not exist "%ATLAS_LOGS%" mkdir "%ATLAS_LOGS%" >nul 2>&1

set "LAUNCHER=%~dp0"
exit /b 0
