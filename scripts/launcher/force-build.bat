@echo off
REM ===========================================================================
REM  scripts\launcher\force-build.bat
REM  Unconditional `next build`. Lives in its own file so %ERRORLEVEL% can be
REM  read without delayed expansion (batch blocks expand %VAR% too early).
REM  Exit 0 = build succeeded, 1 = build failed.
REM ===========================================================================

call "%~dp0_common.bat"

echo  Forcing a frontend rebuild...
pushd "%ATLAS_ROOT%\frontend"
call npm run build
set "CODE=%ERRORLEVEL%"
popd

if not "%CODE%"=="0" (
  echo.
  echo  [X] next build failed with code %CODE%.
  exit /b 1
)
echo  Rebuild complete.
exit /b 0
