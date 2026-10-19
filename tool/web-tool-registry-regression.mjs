import assert from "node:assert/strict";
import { WebToolRegistry } from "../mcp-server/src/tool-registry.js";
import { createWebToolBundle } from "../mcp-server/src/web-tool-bundle.js";
import { webCapabilityAliases } from "../mcp-server/src/capability-contract.js";

const registry = new WebToolRegistry("http://127.0.0.1:8791");
const publicTools = registry.listTools();
const workerCapabilities = registry.listWorkerCapabilities();

const expectedCanonicalAliases = [
  "web.browser.status",
  "web.browser.restart",
  "web.browser.kill",
];

const expectedMergedCapabilities = [
  "web.health_full",
  "web.shared_browser_status",
  "web.browser_cdp_targets",
  "web.browser_cdp_verify_chatgpt_home",
  "web.browser_cdp_cleanup_plan_chatgpt_home",
  "web.browser_cdp_cleanup_chatgpt_home",
  "web.surface_plan",
  "web.surface_execute",
  "web.browser_targets",
  "web.browser_bind",
  "web.page_capture",
  "web.wait_for_ready",
  "web.upload_artifact",
  "web.submit_after_approval",
];

assert.equal(workerCapabilities.length, 28, "worker capability contract should preserve all merged worker routes");
assert.equal(publicTools.length > workerCapabilities.length, true, "public Browsing surface should expose canonical Web aliases in addition to worker ABI capability names");
for (const name of ["web.browser.targets", "web.browser.bind", "web.target.open", "web.page.capture", "web.page.wait", "web.page.click", "web.form.inspect", "web.form.fill", "web.form.upload", "web.form.submit", "web.job.open"]) {
  assert.equal(publicTools.includes(name), true, `public Browser MCP surface must include canonical tool: ${name}`);
}
assert.equal(publicTools.includes("web.open_fresh"), false, "web.open_fresh must not be reported as a public MCP tool");
assert.equal(publicTools.includes("web.connector_sync_execute"), false, "web.connector_sync_execute must remain an internal worker capability");
assert.equal(workerCapabilities.includes("web.open_fresh"), true, "web.open_fresh must remain an internal worker capability");
assert.equal(workerCapabilities.includes("web.connector_sync_execute"), true, "web.connector_sync_execute must remain available to the bundle implementation");

for (const name of expectedCanonicalAliases) {
  assert.equal(publicTools.includes(name), true, `public surface must include canonical alias: ${name}`);
}
for (const name of expectedMergedCapabilities) {
  assert.equal(publicTools.includes(name), true, `public surface must preserve merged capability: ${name}`);
}
for (const name of publicTools) {
  const workerName = webCapabilityAliases[name] ?? name;
  assert.equal(workerCapabilities.includes(workerName), true, `public Web tool must resolve to a worker capability: ${name} -> ${workerName}`);
}

const registered = [];
const fakeServer = {
  registerTool(name, config, handler) {
    registered.push({ name, config, handler });
  },
};
createWebToolBundle({ workerUrl: "http://127.0.0.1:8791", browserWorkerToken: "" }).register(fakeServer);
assert.deepEqual(
  registered.map((item) => item.name).sort(),
  [...publicTools].sort(),
  "WebToolRegistry.listTools() must exactly match the MCP bundle registration surface",
);

for (const [canonical, legacy] of [
  ["web.browser.status", "web.browser_status"],
  ["web.browser.restart", "web.browser_restart"],
  ["web.browser.kill", "web.browser_kill"],
  ["web.job.open", "web.open_job"],
  ["web.form.fill", "web.fill_after_approval"],
  ["web.form.upload", "web.upload_artifact"],
  ["web.chatgpt.snapshot", "web.chatgpt_snapshot"],
  ["web.form.extract", "web.extract_form"],
  ["web.form.review.snapshot", "web.review_before_submit"],
  ["web.form.proposal.preview", "web.propose"],
]) {
  const canonicalRegistration = registered.find((item) => item.name === canonical);
  const legacyRegistration = registered.find((item) => item.name === legacy);
  assert.ok(canonicalRegistration && legacyRegistration, `missing alias pair: ${canonical} / ${legacy}`);
  assert.equal(canonicalRegistration.config, legacyRegistration.config, `alias pair must share exact config object: ${canonical}`);
  assert.equal(canonicalRegistration.handler, legacyRegistration.handler, `alias pair must share exact callback: ${canonical}`);
}

console.log("Web tool registry surface regression passed.");
