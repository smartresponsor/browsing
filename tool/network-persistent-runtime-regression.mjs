import assert from "node:assert/strict";
import fs from "node:fs";

const supervisor = fs.readFileSync(new URL("../tool/dev-browser.ps1", import.meta.url), "utf8");
const persistentTaskModule = fs.readFileSync(new URL("../tool/dev-network.d/47-mcp-persistent-task.ps1", import.meta.url), "utf8");
const launcher = fs.readFileSync(new URL("../tool/start-persistent-mcp.ps1", import.meta.url), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const persistentRuntime = supervisor + "\n" + persistentTaskModule;

for (const command of [
  "install-mcp-startup-task",
  "start-mcp-startup-task",
  "stop-mcp-startup-task",
  "uninstall-mcp-startup-task",
  "show-mcp-startup-task",
]) {
  assert.equal(supervisor.includes("'" + command + "'"), true, `missing persistent MCP supervisor command: ${command}`);
}

assert.equal(supervisor.includes("$McpStartupTaskName = 'browser-mcp-server'"), true, "persistent MCP Scheduled Task identity missing");
assert.equal(supervisor.includes("$NetworkRoot = $Root"), true, "supervisor must preserve NetworkRoot before dot-sourcing secret-runtime");
assert.equal(supervisor.includes("$RequestedSupervisorCommand = $Command"), true, "supervisor must preserve Command before dot-sourcing secret-runtime");
assert.equal(supervisor.includes("$Root = $NetworkRoot"), true, "supervisor must restore NetworkRoot after secret-runtime export-env");
assert.equal(supervisor.includes("$Command = $RequestedSupervisorCommand"), true, "supervisor must restore Command after secret-runtime export-env");
assert.equal(supervisor.includes("dev-network.d\\47-mcp-persistent-task.ps1"), true, "persistent MCP task lifecycle module must be loaded");
assert.equal(persistentRuntime.includes("-ExecutionTimeLimit ([TimeSpan]::Zero)"), true, "persistent MCP task must not have a finite execution timeout");
assert.equal(persistentRuntime.includes("Invoke-McpSmoke | ConvertFrom-Json"), true, "persistent MCP start must verify smoke before reporting success");
assert.equal(persistentRuntime.includes("start-persistent-mcp.ps1"), true, "persistent MCP task must invoke the foreground launcher");

assert.equal(launcher.includes("AwsSecretContract\\tool\\secret-runtime.ps1"), true, "persistent launcher must import the shared secret runtime");
assert.equal(launcher.includes("BROWSER_MCP_SERVER_PORT"), true, "persistent launcher must bind the configured MCP port");
assert.equal(launcher.includes("$process.WaitForExit()"), true, "persistent launcher must remain alive while the MCP child runs");
assert.equal(launcher.includes("mcp-server.pid"), true, "persistent launcher must maintain the MCP pid file");
assert.equal(launcher.includes("Get-NetTCPConnection -LocalPort $port -State Listen"), true, "persistent launcher must fail closed on port conflicts");

for (const script of [
  "dev:mcp-task-install",
  "dev:mcp-task-start",
  "dev:mcp-task-stop",
  "dev:mcp-task-uninstall",
  "dev:mcp-task-show",
]) {
  assert.equal(typeof pkg.scripts?.[script], "string", `missing npm lifecycle script: ${script}`);
}

console.log("Network persistent MCP lifecycle regression passed.");
