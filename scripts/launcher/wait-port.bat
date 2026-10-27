@echo off
REM ===========================================================================
REM  scripts\launcher\wait-port.bat <port> <label> [tries]
REM  Polls until <port> is listening. Default 20 tries at 2 s = 40 s.
REM  Exit 0 on success, 1 on timeout.
REM ===========================================================================

setlocal EnableDelayedExpansion
set "P=%~1"
set "LABEL=%~2"
set "TRIES=%~3"
if "%TRIES%"=="" set "TRIES=20"
if "%LABEL%"=="" set "LABEL=service"

set /a N=0
:loop
call "%~dp0port-free.bat" %P%
if errorlevel 1 (
  echo    %LABEL% is listening on %P%
  endlocal & exit /b 0
)
set /a N+=1
if !N! GEQ %TRIES% (
  echo    [!] %LABEL% did not open port %P% within the wait window.
  endlocal & exit /b 1
)
call "%~dp0sleep.bat" 2
goto :loop
