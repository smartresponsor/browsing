import assert from "node:assert/strict";
import { NetworkToolRegistry } from "../mcp-server/src/tool-registry.js";
import { createNetworkToolBundle } from "../mcp-server/src/network-tool-bundle.js";

const registry = new NetworkToolRegistry("http://127.0.0.1:8791");
const publicTools = registry.listTools();
const workerCapabilities = registry.listWorkerCapabilities();

const expectedCanonicalAliases = [
  "network.browser.status",
  "network.browser.restart",
  "network.browser.kill",
  "network.job.open",
  "network.form.fill",
  "network.chatgpt.snapshot",
  "network.form.extract",
  "network.form.review.snapshot",
  "network.form.proposal.preview",
];

const expectedMergedCapabilities = [
  "network.health_full",
  "network.shared_browser_status",
  "network.browser_cdp_targets",
  "network.browser_cdp_verify_chatgpt_home",
  "network.browser_cdp_cleanup_plan_chatgpt_home",
  "network.browser_cdp_cleanup_chatgpt_home",
  "network.surface_plan",
  "network.surface_execute",
  "network.browser_targets",
  "network.browser_bind",
  "network.page_capture",
  "network.wait_for_ready",
  "network.submit_after_approval",
];

assert.equal(publicTools.length, 34, "public Network MCP surface should preserve merged runtime capabilities plus canonical aliases");
assert.equal(workerCapabilities.length, 27, "worker capability contract should preserve all merged worker routes");
assert.equal(publicTools.includes("network.open_fresh"), false, "network.open_fresh must not be reported as a public MCP tool");
assert.equal(publicTools.includes("network.connector_sync_execute"), false, "network.connector_sync_execute must remain an internal worker capability");
assert.equal(workerCapabilities.includes("network.open_fresh"), true, "network.open_fresh must remain an internal worker capability");
assert.equal(workerCapabilities.includes("network.connector_sync_execute"), true, "network.connector_sync_execute must remain available to the bundle implementation");

for (const name of expectedCanonicalAliases) {
  assert.equal(publicTools.includes(name), true, `public surface must include canonical alias: ${name}`);
}
for (const name of expectedMergedCapabilities) {
  assert.equal(publicTools.includes(name), true, `public surface must preserve merged capability: ${name}`);
}
for (const name of publicTools) {
  if (expectedCanonicalAliases.includes(name)) {
    continue;
  }
  assert.equal(workerCapabilities.includes(name), true, `worker capability surface must retain public worker tool: ${name}`);
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
  ["network.chatgpt.snapshot", "network.chatgpt_snapshot"],
  ["network.form.extract", "network.extract_form"],
  ["network.form.review.snapshot", "network.review_before_submit"],
  ["network.form.proposal.preview", "network.propose"],
]) {
  const canonicalRegistration = registered.find((item) => item.name === canonical);
  const legacyRegistration = registered.find((item) => item.name === legacy);
  assert.ok(canonicalRegistration && legacyRegistration, `missing alias pair: ${canonical} / ${legacy}`);
  assert.equal(canonicalRegistration.config, legacyRegistration.config, `alias pair must share exact config object: ${canonical}`);
  assert.equal(canonicalRegistration.handler, legacyRegistration.handler, `alias pair must share exact callback: ${canonical}`);
}

console.log("Network tool registry surface regression passed.");
