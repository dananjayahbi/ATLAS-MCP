@echo off
REM ===========================================================================
REM  scripts\launcher\start-backend.bat
REM  Django API + SSE on 127.0.0.1:%ATLAS_BACKEND_PORT% (default 8471).
REM
REM  Uses uvicorn (ASGI) rather than `manage.py runserver`: SSE needs a real
REM  streaming server and uvicorn handles concurrent long-lived responses.
REM ===========================================================================

call "%~dp0_common.bat"
title ATLAS backend :%ATLAS_BACKEND_PORT%
cd /d "%ATLAS_ROOT%"

call "%~dp0preflight.bat"
if errorlevel 1 goto :die

call "%~dp0port-free.bat" %ATLAS_BACKEND_PORT%
if errorlevel 1 (
  echo  [!] Port %ATLAS_BACKEND_PORT% is already in use.
  echo      Stop the other process, or set ATLAS_BACKEND_PORT to a free port.
  goto :die
)

set "DJANGO_SETTINGS_MODULE=atlas.settings.dev"
set "PYTHONUNBUFFERED=1"
set "PYTHONPATH=%ATLAS_ROOT%\backend"

echo  Starting Django (ASGI) on http://127.0.0.1:%ATLAS_BACKEND_PORT%
echo  Health: http://127.0.0.1:%ATLAS_BACKEND_PORT%/healthz
echo  Logs:   %ATLAS_LOGS%\backend.log
echo.

pushd "%ATLAS_ROOT%\backend"
"%ATLAS_VENV_PY%" -m uvicorn atlas.asgi:application ^
  --host 127.0.0.1 ^
  --port %ATLAS_BACKEND_PORT% ^
  --log-level info ^
  --no-access-log ^
  --timeout-keep-alive 75 ^
  2>&1 | "%ATLAS_VENV_PY%" -u "%ATLAS_ROOT%\scripts\launcher\tee.py" "%ATLAS_LOGS%\backend.log"
set "EXITCODE=%ERRORLEVEL%"
popd

echo.
echo  Backend exited with code %EXITCODE%.
pause
exit /b %EXITCODE%

:die
echo.
echo  Backend did not start. Press any key to close.
pause >nul
exit /b 1
