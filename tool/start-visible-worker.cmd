@echo off
setlocal

set "ROOT=%~dp0.."
set "PID_FILE=%ROOT%\var\run\playwright-worker.pid"
set "WORKER=%ROOT%\playwright-worker\src\worker.js"
set "LOG_DIR=%ROOT%\var\log"
set "LOG_FILE=%LOG_DIR%\playwright-worker.visible.log"
set "ERR_FILE=%LOG_DIR%\playwright-worker.visible.err.log"

if not exist "%ROOT%\var\run" mkdir "%ROOT%\var\run"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if exist "%PID_FILE%" (
  for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "OLD_PID=%%P"
  if defined OLD_PID (
    taskkill /PID %OLD_PID% /T /F >nul 2>nul
  )
  del /f /q "%PID_FILE%" >nul 2>nul
)

set "PORT=8791"
set "NETWORK_MCP_HEADLESS=false"
if "%NETWORK_MCP_BROWSER_CHANNEL%"=="" set "NETWORK_MCP_BROWSER_CHANNEL=chromium"
if "%NETWORK_MCP_USER_DATA_DIR%"=="" set "NETWORK_MCP_USER_DATA_DIR=var\browser\profile"
if "%NETWORK_MCP_EXTERNAL_VISIBLE_CHROME%"=="" set "NETWORK_MCP_EXTERNAL_VISIBLE_CHROME=true"
set "NETWORK_MCP_REMOTE_DEBUGGING_PORT=9223"

title Network MCP visible playwright-worker
cd /d "%ROOT%"
echo Starting visible Network MCP playwright-worker on port %PORT% ...
echo Browser channel: %NETWORK_MCP_BROWSER_CHANNEL%
echo External visible Chrome: %NETWORK_MCP_EXTERNAL_VISIBLE_CHROME%
echo User data dir: %NETWORK_MCP_USER_DATA_DIR%
echo Log: %LOG_FILE%
echo Error log: %ERR_FILE%
echo This window must stay open while using the supervised browser.
echo.

>> "%LOG_FILE%" echo [%date% %time%] Starting visible worker on port %PORT%, channel=%NETWORK_MCP_BROWSER_CHANNEL%, externalVisibleChrome=%NETWORK_MCP_EXTERNAL_VISIBLE_CHROME%, userDataDir=%NETWORK_MCP_USER_DATA_DIR%
node --enable-source-maps "%WORKER%" >> "%LOG_FILE%" 2>> "%ERR_FILE%"
set "EXIT_CODE=%ERRORLEVEL%"
>> "%LOG_FILE%" echo [%date% %time%] Visible worker exited with code %EXIT_CODE%.
echo Visible worker exited with code %EXIT_CODE%.
if not "%EXIT_CODE%"=="0" pause
