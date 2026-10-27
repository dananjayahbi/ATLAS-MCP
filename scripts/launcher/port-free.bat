@echo off
REM ===========================================================================
REM  scripts\launcher\port-free.bat <port>
REM  Exit 0 when nothing is listening on <port>, 1 when it is taken.
REM  Uses `netstat` only (no PowerShell) so it works in any CMD context.
REM ===========================================================================

setlocal
set "P=%~1"
if "%P%"=="" exit /b 1

netstat -ano -p TCP 2>nul | findstr /R /C:":%P% .*LISTENING" >nul 2>&1
if errorlevel 1 (
  endlocal & exit /b 0
)
endlocal & exit /b 1
