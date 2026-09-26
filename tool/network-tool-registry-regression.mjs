import assert from "node:assert/strict";
import { NetworkToolRegistry } from "../mcp-server/src/tool-registry.js";

const registry = new NetworkToolRegistry("http://127.0.0.1:8791");
const publicTools = registry.listTools();
const workerCapabilities = registry.listWorkerCapabilities();

assert.equal(publicTools.length, 12, "public Network MCP surface should contain 12 registered tools");
assert.equal(publicTools.includes("network.open_fresh"), false, "network.open_fresh must not be reported as a public MCP tool");
assert.equal(workerCapabilities.length, 13, "worker capability surface should include the 12 public tools plus open_fresh");
assert.equal(workerCapabilities.includes("network.open_fresh"), true, "network.open_fresh must remain an internal worker capability");
for (const name of publicTools) {
  assert.equal(workerCapabilities.includes(name), true, `worker capability surface must retain public tool: ${name}`);
}

console.log("Network tool registry surface regression passed.");
