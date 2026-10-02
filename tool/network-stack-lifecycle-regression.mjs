import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../tool/dev-network.d/60-stack-lifecycle.ps1", import.meta.url), "utf8");
const supervisor = fs.readFileSync(new URL("../tool/dev-browser.ps1", import.meta.url), "utf8");

for (const token of [
  "function Convert-StackComponentResult",
  "if ($Value -is [string])",
  "return ($Value | ConvertFrom-Json)",
  "$worker = Start-Worker | Convert-StackComponentResult",
  "$mcp = Start-McpServer | Convert-StackComponentResult",
  "$legacyTunnel = Stop-Tunnel | Convert-StackComponentResult",
  "$namedTunnel = Start-NamedTunnel | Convert-StackComponentResult",
]) {
  assert.equal(source.includes(token), true, `Stack lifecycle normalization invariant missing: ${token}`);
}

assert.equal(
  source.includes("$worker | ConvertFrom-Json"),
  false,
  "Start-Stack must not blindly JSON-decode an already-object worker state",
);

for (const token of [
  "'restart-worker',",
  "'restart-worker' {",
  "Stop-Worker | Out-Null",
  "Start-Worker",
]) {
  assert.equal(supervisor.includes(token), true, `Worker-only restart invariant missing: ${token}`);
}

console.log("Network stack lifecycle normalization regression passed.");

