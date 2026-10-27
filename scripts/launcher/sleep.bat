@echo off
REM ===========================================================================
REM  scripts\launcher\sleep.bat <seconds>
REM  `timeout` refuses to run when stdin is redirected (CI, piping), so this
REM  uses `ping` as a portable delay instead.
REM ===========================================================================

setlocal
set "S=%~1"
if "%S%"=="" set "S=2"
set /a COUNT=%S%+1
ping -n %COUNT% 127.0.0.1 >nul 2>&1
endlocal & exit /b 0
