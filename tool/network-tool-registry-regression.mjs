import assert from "node:assert/strict";
import { NetworkToolRegistry } from "../mcp-server/src/tool-registry.js";
import { createNetworkToolBundle } from "../mcp-server/src/network-tool-bundle.js";

const registry = new NetworkToolRegistry("http://127.0.0.1:8791");
const publicTools = registry.listTools();
const workerCapabilities = registry.listWorkerCapabilities();

assert.equal(publicTools.length, 17, "public Network MCP surface should contain 12 legacy/current names plus five canonical aliases");
assert.equal(publicTools.includes("network.open_fresh"), false, "network.open_fresh must not be reported as a public MCP tool");
assert.equal(workerCapabilities.length, 18, "worker capability surface should include the 17 public names plus open_fresh");
assert.equal(workerCapabilities.includes("network.open_fresh"), true, "network.open_fresh must remain an internal worker capability");
for (const name of publicTools) {
  assert.equal(workerCapabilities.includes(name), true, `worker capability surface must retain public tool: ${name}`);
}

const expectedCanonicalAliases = [
  "network.browser.status",
  "network.browser.restart",
  "network.browser.kill",
  "network.job.open",
  "network.form.fill",
];
for (const name of expectedCanonicalAliases) {
  assert.equal(publicTools.includes(name), true, `public surface must include canonical alias: ${name}`);
}

const registered = [];
const fakeServer = {
  registerTool(name, config, handler) {
    registered.push({ name, config, handler });
  },
};
createNetworkToolBundle({ workerUrl: "http://127.0.0.1:8791", browserWorkerToken: "" }).register(fakeServer);
assert.deepEqual(
  registered.map((item) => item.name).sort(),
  [...publicTools].sort(),
  "NetworkToolRegistry.listTools() must exactly match the MCP bundle registration surface",
);

for (const [canonical, legacy] of [
  ["network.browser.status", "network.browser_status"],
  ["network.browser.restart", "network.browser_restart"],
  ["network.browser.kill", "network.browser_kill"],
  ["network.job.open", "network.open_job"],
  ["network.form.fill", "network.fill_after_approval"],
]) {
  const canonicalRegistration = registered.find((item) => item.name === canonical);
  const legacyRegistration = registered.find((item) => item.name === legacy);
  assert.ok(canonicalRegistration && legacyRegistration, `missing alias pair: ${canonical} / ${legacy}`);
  assert.equal(canonicalRegistration.config, legacyRegistration.config, `alias pair must share exact config object: ${canonical}`);
  assert.equal(canonicalRegistration.handler, legacyRegistration.handler, `alias pair must share exact callback: ${canonical}`);
}

console.log("Network tool registry surface regression passed.");
