@echo off
setlocal

set "SCRIPT_DIR=%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found in PATH.
  echo Install Node.js and try again.
  pause
  exit /b 1
)

pushd "%SCRIPT_DIR%"

node server.js
if errorlevel 1 (
  echo.
  echo Failed to start the DIS test web server.
  popd
  pause
  exit /b 1
)

start "" "http://127.0.0.1:7070"
popd
endlocal
