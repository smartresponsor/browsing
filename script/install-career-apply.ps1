$ErrorActionPreference = "Stop"
Write-Host "Installing Career Apply RC1 dependencies..."
npm --prefix .\mcp-server install
npm --prefix .\playwright-worker install
npm --prefix .\playwright-worker run install:browsers
Write-Host "Done."
