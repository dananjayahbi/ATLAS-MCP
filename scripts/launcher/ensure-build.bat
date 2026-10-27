@echo off
REM ===========================================================================
REM  scripts\launcher\ensure-build.bat
REM  Builds the Next.js production bundle when it is missing or stale.
REM  Exit 0 = a usable bundle exists, 1 = build failed / unavailable.
REM ===========================================================================

call "%~dp0_common.bat"

if not exist "%ATLAS_ROOT%\frontend\.env.local" (
  echo  [i] frontend\.env.local missing; generating from .env ...
  "%ATLAS_VENV_PY%" "%ATLAS_ROOT%\scripts\launcher\sync_env.py"
  if errorlevel 1 exit /b 1
)

if not exist "%ATLAS_ROOT%\frontend\.next\BUILD_ID" goto :build

"%ATLAS_VENV_PY%" "%ATLAS_ROOT%\scripts\launcher\needs_build.py" "%ATLAS_ROOT%\frontend"
if not errorlevel 1 (
  echo  Using the existing production bundle in frontend\.next
  exit /b 0
)

:build
echo  Building the production bundle ^(first run or sources changed^)...
echo.
pushd "%ATLAS_ROOT%\frontend"
call npm run build
set "CODE=%ERRORLEVEL%"
popd
if not "%CODE%"=="0" (
  echo.
  echo  [X] next build failed with code %CODE%.
  exit /b 1
)
echo.
exit /b 0
