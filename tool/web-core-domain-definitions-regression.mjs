import assert from "node:assert/strict";

import { createWebCoreDomainToolDefinitions } from "../mcp-server/src/web-domain-tool-definitions.js";
import { webCapabilityContract } from "../mcp-server/src/capability-contract.js";

const definitions = createWebCoreDomainToolDefinitions();
const contractByName = new Map(webCapabilityContract.tools.map((tool) => [tool.name, tool]));

assert.equal(definitions.length, 15, "Core Console-consumable Web domain surface must have 15 definitions");
assert.equal(new Set(definitions.map((tool) => tool.canonicalName)).size, definitions.length, "Core domain canonical names must be unique");
assert.equal(new Set(definitions.map((tool) => tool.consoleName)).size, definitions.length, "Console-prefixed Web names must be unique");

for (const tool of definitions) {
  assert.ok(["read", "write"].includes(tool.access), `Invalid Web definition access: ${tool.canonicalName}`);
  assert.equal(
    tool.consoleName.startsWith(tool.access === "read" ? "read_.web." : "write.web."),
    true,
    `Console name access prefix mismatch: ${tool.consoleName}`,
  );

  const contract = contractByName.get(tool.capabilityName);
  assert.ok(contract, `Missing Capability Contract entry for definition: ${tool.capabilityName}`);
  assert.equal(tool.route, contract.route, `Worker route mismatch for ${tool.capabilityName}`);
  assert.equal(contract.visibility, "public", `Console-consumable Web capability must be public: ${tool.capabilityName}`);
  assert.ok(tool.inputSchema && typeof tool.inputSchema.safeParse === "function", `Missing Zod input schema: ${tool.canonicalName}`);
  assert.equal(typeof tool.toPayload, "function", `Missing payload mapper: ${tool.canonicalName}`);
}

for (const required of [
  "read_.web.browser.targets",
  "write.web.browser.bind",
  "read_.web.page.capture",
  "read_.web.form.inspect",
  "write.web.page.click",
  "write.web.form.proposal.preview",
  "write.web.form.fill",
  "write.web.form.upload",
  "write.web.form.review.snapshot",
  "write.web.form.submit",
]) {
  assert.ok(definitions.some((tool) => tool.consoleName === required), `Required Console Web domain definition missing: ${required}`);
}

console.log(`Web core domain definitions regression passed: ${definitions.length} Console-consumable tools.`);

