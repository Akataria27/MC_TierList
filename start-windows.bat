@echo off
setlocal
title MC Tier List
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode
where npm >nul 2>nul
if errorlevel 1 goto nonode

if exist "node_modules\electron\dist\electron.exe" goto run

echo First launch: installing Electron. This needs internet once and can take a minute or two...
call npm install --no-audit --no-fund
if exist "node_modules\electron\dist\electron.exe" goto run
if not exist "node_modules\electron\install.js" goto npmfail

REM Newer npm skips install scripts until approved, so run Electron's own download step directly.
echo Downloading Electron...
if defined ELECTRON_SKIP_BINARY_DOWNLOAD echo Note: ELECTRON_SKIP_BINARY_DOWNLOAD is set on this computer; ignoring it.
set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "ELECTRON_OVERRIDE_DIST_PATH="
set "DEBUG=electron-download,@electron/get:*"
node "node_modules\electron\install.js"
echo Download step finished with code %errorlevel%.
if exist "node_modules\electron\dist\electron.exe" goto run

echo Electron did not unpack. Trying Windows' own unzip on the downloaded file...
set "EZIP="
for /f "delims=" %%F in ('dir /s /b "%LOCALAPPDATA%\electron\Cache\electron-v*-win32-x64.zip" 2^>nul') do set "EZIP=%%F"
if not defined EZIP goto npmfail
echo Using %EZIP%
if exist "node_modules\electron\dist" rmdir /s /q "node_modules\electron\dist"
powershell -NoProfile -Command "Expand-Archive -LiteralPath $env:EZIP -DestinationPath 'node_modules\electron\dist' -Force"
<nul set /p "=electron.exe" > "node_modules\electron\path.txt"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Still no electron.exe. Contents of the dist folder:
  dir "node_modules\electron\dist" 2>nul
  echo If it is empty, antivirus software may have removed electron.exe: allow this folder and try again.
  goto npmfail
)

:run
call "node_modules\.bin\electron.cmd" .
if errorlevel 1 goto runfail
exit /b 0

:nonode
echo.
echo Node.js is required. Install the LTS version from https://nodejs.org,
echo then close this window and double-click start-windows.bat again.
echo.
pause
exit /b 1

:npmfail
echo.
echo Installing Electron failed. Check your internet connection and try again.
echo If this is a work or school computer, a firewall may be blocking github.com downloads.
echo If it keeps failing, delete the node_modules folder here and run this again.
echo.
pause
exit /b 1

:runfail
echo.
echo MC Tier List stopped with an error (see the messages above).
echo.
pause
exit /b 1
