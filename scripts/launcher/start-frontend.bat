@echo off
REM ===========================================================================
REM  scripts\launcher\start-frontend.bat
REM  Next.js production server (`next start`) on 127.0.0.1:%ATLAS_WEB_PORT%
REM  (default 3471), serving the built .next bundle.
REM ===========================================================================

call "%~dp0_common.bat"
title ATLAS frontend :%ATLAS_WEB_PORT%
cd /d "%ATLAS_ROOT%"

call "%~dp0preflight.bat"
if errorlevel 1 goto :die

call "%~dp0port-free.bat" %ATLAS_WEB_PORT%
if errorlevel 1 (
  echo  [!] Port %ATLAS_WEB_PORT% is already in use.
  echo      Stop the other process, or set ATLAS_WEB_PORT to a free port.
  goto :die
)

call "%~dp0ensure-build.bat"
if errorlevel 1 goto :die

pushd "%ATLAS_ROOT%\frontend"
set "NODE_ENV=production"

echo  Starting Next.js on http://127.0.0.1:%ATLAS_WEB_PORT%
echo  Logs:  %ATLAS_LOGS%\frontend.log
echo.

call npx --no-install next start -p %ATLAS_WEB_PORT% -H 127.0.0.1 2>&1 | "%ATLAS_VENV_PY%" -u "%ATLAS_ROOT%\scripts\launcher\tee.py" "%ATLAS_LOGS%\frontend.log"
set "EXITCODE=%ERRORLEVEL%"
popd

echo.
echo  Frontend exited with code %EXITCODE%.
pause
exit /b %EXITCODE%

:die
echo.
echo  Frontend did not start. Press any key to close.
pause >nul
exit /b 1
