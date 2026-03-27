@echo off
cd /d "%~dp0"
set CSC_IDENTITY_AUTO_DISCOVERY=false
echo Installing dependencies...
call npm install
if errorlevel 1 goto :fail

echo Building Windows portable EXE...
call npm run dist-win
if errorlevel 1 goto :fail

echo.
echo Done. The portable EXE will be in the dist folder.
pause
exit /b 0

:fail
echo.
echo Build failed.
pause
exit /b 1
