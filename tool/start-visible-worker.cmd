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
set "BROWSER_MCP_HEADLESS=false"
if "%BROWSER_MCP_BROWSER_CHANNEL%"=="" set "BROWSER_MCP_BROWSER_CHANNEL=msedge"
if "%BROWSER_MCP_SHARED_BROWSER_ROOT%"=="" set "BROWSER_MCP_SHARED_BROWSER_ROOT=%ROOT%\..\browser"
if "%BROWSER_MCP_USER_DATA_DIR%"=="" set "BROWSER_MCP_USER_DATA_DIR=%BROWSER_MCP_SHARED_BROWSER_ROOT%\profile"
if "%BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER%"=="" set "BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER=true"
if "%BROWSER_MCP_EXTERNAL_VISIBLE_CHROME%"=="" set "BROWSER_MCP_EXTERNAL_VISIBLE_CHROME=%BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER%"
set "BROWSER_MCP_REMOTE_DEBUGGING_PORT=9223"

title Browser MCP visible playwright-worker
cd /d "%ROOT%"
echo Starting visible Browser MCP playwright-worker on port %PORT% ...
echo Browser channel: %BROWSER_MCP_BROWSER_CHANNEL%
echo External visible browser: %BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER%
echo Shared browser root: %BROWSER_MCP_SHARED_BROWSER_ROOT%
echo User data dir: %BROWSER_MCP_USER_DATA_DIR%
echo Log: %LOG_FILE%
echo Error log: %ERR_FILE%
echo This window must stay open while using the supervised browser.
echo.

>> "%LOG_FILE%" echo [%date% %time%] Starting visible worker on port %PORT%, channel=%BROWSER_MCP_BROWSER_CHANNEL%, externalVisibleBrowser=%BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER%, legacyExternalVisibleChrome=%BROWSER_MCP_EXTERNAL_VISIBLE_CHROME%, sharedBrowserRoot=%BROWSER_MCP_SHARED_BROWSER_ROOT%, userDataDir=%BROWSER_MCP_USER_DATA_DIR%
node --enable-source-maps "%WORKER%" >> "%LOG_FILE%" 2>> "%ERR_FILE%"
set "EXIT_CODE=%ERRORLEVEL%"
>> "%LOG_FILE%" echo [%date% %time%] Visible worker exited with code %EXIT_CODE%.
echo Visible worker exited with code %EXIT_CODE%.
if not "%EXIT_CODE%"=="0" pause
