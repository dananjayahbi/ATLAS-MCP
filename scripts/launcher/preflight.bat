@echo off
REM ===========================================================================
REM  scripts\launcher\preflight.bat
REM  Verifies the repo can be started. Exit 0 = ready, 1 = something to fix.
REM  Prints a concrete remedy for every failure.
REM ===========================================================================

call "%~dp0_common.bat"

set "OK=0"

if not exist "%ATLAS_VENV_PY%" (
  echo  [X] Python virtualenv not found:
  echo      %ATLAS_VENV_PY%
  echo      Fix: python -m venv .venv
  echo           .venv\Scripts\python.exe -m pip install -r backend\requirements.txt
  set "OK=1"
)

if not exist "%ATLAS_ROOT%\.env" (
  echo  [X] .env is missing.
  echo      Fix: .venv\Scripts\python.exe scripts\bootstrap_dev.py
  set "OK=1"
)

if not exist "%ATLAS_ROOT%\frontend\node_modules\next" (
  echo  [X] frontend\node_modules is missing.
  echo      Fix: npm --prefix frontend install
  set "OK=1"
)

if "%OK%"=="1" exit /b 1
exit /b 0
