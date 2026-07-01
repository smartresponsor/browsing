@echo off
setlocal

set "ROOT=D:\PhpstormProjects\www\mcp\network-mcp"
set "PORT=9223"
set "PROFILE=%ROOT%\var\browser\profile"
set "URL=http://127.0.0.1:8791/healthz"

if not "%NETWORK_MCP_REMOTE_DEBUGGING_PORT%"=="" set "PORT=%NETWORK_MCP_REMOTE_DEBUGGING_PORT%"
if not "%NETWORK_MCP_USER_DATA_DIR%"=="" set "PROFILE=%NETWORK_MCP_USER_DATA_DIR%"
if not "%NETWORK_MCP_VISIBLE_CHROME_URL%"=="" set "URL=%NETWORK_MCP_VISIBLE_CHROME_URL%"

set "BROWSER=%NETWORK_MCP_BROWSER_EXECUTABLE%"
if "%BROWSER%"=="" if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "BROWSER=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if "%BROWSER%"=="" if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if "%BROWSER%"=="" if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe"
if "%BROWSER%"=="" if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if "%BROWSER%"=="" (
  echo No supported browser executable found. Set NETWORK_MCP_BROWSER_EXECUTABLE to msedge.exe or chrome.exe.
  exit /b 1
)

if not exist "%PROFILE%" mkdir "%PROFILE%" >nul 2>nul

echo Starting visible MCP browser from the current interactive desktop session.
echo Browser: %BROWSER%
echo CDP: http://127.0.0.1:%PORT%
echo Profile: %PROFILE%

start "network-mcp visible chrome" "%BROWSER%" ^
  --remote-debugging-port=%PORT% ^
  --user-data-dir="%PROFILE%" ^
  --no-first-run ^
  --no-default-browser-check ^
  --disable-background-mode ^
  --new-window ^
  --start-maximized ^
  --window-position=80,80 ^
  --window-size=1400,1000 ^
  "%URL%"

endlocal
