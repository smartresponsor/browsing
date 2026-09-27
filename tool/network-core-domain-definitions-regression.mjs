import assert from "node:assert/strict";

import { createNetworkCoreDomainToolDefinitions } from "../mcp-server/src/core-domain-tool-definitions.js";
import { networkCapabilityContract } from "../mcp-server/src/capability-contract.js";

const definitions = createNetworkCoreDomainToolDefinitions();
const contractByName = new Map(networkCapabilityContract.tools.map((tool) => [tool.name, tool]));

assert.equal(definitions.length, 15, "Core Console-consumable Network domain surface must have 15 definitions");
assert.equal(new Set(definitions.map((tool) => tool.canonicalName)).size, definitions.length, "Core domain canonical names must be unique");
assert.equal(new Set(definitions.map((tool) => tool.consoleName)).size, definitions.length, "Console-prefixed Network names must be unique");

for (const tool of definitions) {
  assert.ok(["read", "write"].includes(tool.access), `Invalid Network definition access: ${tool.canonicalName}`);
  assert.equal(
    tool.consoleName.startsWith(tool.access === "read" ? "console.read_.network." : "console.write.network."),
    true,
    `Console name access prefix mismatch: ${tool.consoleName}`,
  );

  const contract = contractByName.get(tool.capabilityName);
  assert.ok(contract, `Missing Capability Contract entry for definition: ${tool.capabilityName}`);
  assert.equal(tool.route, contract.route, `Worker route mismatch for ${tool.capabilityName}`);
  assert.equal(contract.visibility, "public", `Console-consumable Network capability must be public: ${tool.capabilityName}`);
  assert.ok(tool.inputSchema && typeof tool.inputSchema.safeParse === "function", `Missing Zod input schema: ${tool.canonicalName}`);
  assert.equal(typeof tool.toPayload, "function", `Missing payload mapper: ${tool.canonicalName}`);
}

for (const required of [
  "console.read_.network.browser.targets",
  "console.write.network.browser.bind",
  "console.read_.network.page.capture",
  "console.read_.network.form.inspect",
  "console.write.network.page.click",
  "console.write.network.form.proposal.preview",
  "console.write.network.form.fill",
  "console.write.network.form.upload",
  "console.write.network.form.review.snapshot",
  "console.write.network.form.submit",
]) {
  assert.ok(definitions.some((tool) => tool.consoleName === required), `Required Console Network domain definition missing: ${required}`);
}

console.log(`Network core domain definitions regression passed: ${definitions.length} Console-consumable tools.`);

