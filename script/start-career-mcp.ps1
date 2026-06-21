$ErrorActionPreference = "Stop"
$env:CAREER_WORKER_URL = "http://127.0.0.1:8791"
npm --prefix .\mcp-server run start
