@echo off
REM ===========================================================================
REM  start-atlas.bat  --  launch the whole ATLAS-MCP stack.
REM
REM  Opens two independent CMD windows:
REM    1. backend  : Django API + SSE on 127.0.0.1:8471   (uvicorn / ASGI)
REM    2. frontend : Next.js production server on 127.0.0.1:3471 (`next start`)
REM
REM  Usage:
REM      start-atlas.bat              normal start
REM      start-atlas.bat --rebuild    force a fresh `next build` first
REM      start-atlas.bat --no-wait    do not wait for the health checks
REM
REM  Override ports without editing anything:
REM      set ATLAS_BACKEND_PORT=8532
REM      set ATLAS_WEB_PORT=3532
REM      start-atlas.bat
REM ===========================================================================

setlocal
call "%~dp0scripts\launcher\_common.bat"

set "REBUILD=0"
set "WAIT=1"
for %%A in (%*) do (
  if /I "%%A"=="--rebuild" set "REBUILD=1"
  if /I "%%A"=="--no-wait" set "WAIT=0"
)

echo.
echo  ============================================================
echo    ATLAS-MCP
echo  ============================================================
echo    backend  : http://127.0.0.1:%ATLAS_BACKEND_PORT%
echo    frontend : http://127.0.0.1:%ATLAS_WEB_PORT%
echo    logs     : %ATLAS_LOGS%
echo  ============================================================
echo.

call "%~dp0scripts\launcher\preflight.bat"
if errorlevel 1 goto :fail

call "%~dp0scripts\launcher\port-free.bat" %ATLAS_BACKEND_PORT%
if errorlevel 1 (
  echo  [X] Backend port %ATLAS_BACKEND_PORT% is already in use.
  echo      Close the other process or set ATLAS_BACKEND_PORT.
  goto :fail
)
call "%~dp0scripts\launcher\port-free.bat" %ATLAS_WEB_PORT%
if errorlevel 1 (
  echo  [X] Frontend port %ATLAS_WEB_PORT% is already in use.
  echo      Close the other process or set ATLAS_WEB_PORT.
  goto :fail
)

if "%REBUILD%"=="1" (
  call "%~dp0scripts\launcher\force-build.bat"
  if errorlevel 1 goto :fail
)

REM Build here (not inside the frontend window) so the health wait that follows
REM actually measures server start-up rather than a cold `next build`.
call "%~dp0scripts\launcher\ensure-build.bat"
if errorlevel 1 goto :fail

echo  Opening the backend window...
start "ATLAS backend :%ATLAS_BACKEND_PORT%" /D "%ATLAS_ROOT%" cmd /k "%LAUNCHER%start-backend.bat"

if "%WAIT%"=="1" call "%~dp0scripts\launcher\wait-port.bat" %ATLAS_BACKEND_PORT% backend 20

echo  Opening the frontend window...
start "ATLAS frontend :%ATLAS_WEB_PORT%" /D "%ATLAS_ROOT%" cmd /k "%LAUNCHER%start-frontend.bat"

if "%WAIT%"=="1" (
  call "%~dp0scripts\launcher\wait-port.bat" %ATLAS_WEB_PORT% frontend 40
  echo.
  echo  Stack is up:
  echo    HUD    : http://127.0.0.1:%ATLAS_WEB_PORT%
  echo    Health : http://127.0.0.1:%ATLAS_BACKEND_PORT%/healthz
  echo    MCP    : .vscode\mcp.json
)

echo.
echo  Close the two server windows to stop the stack.
endlocal
exit /b 0

:fail
echo.
echo  Launcher aborted.
pause
endlocal
exit /b 1
