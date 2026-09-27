import assert from "node:assert/strict";
import fs from "node:fs";

import {
  networkCapabilityAliases,
  networkCapabilityContract,
} from "../mcp-server/src/capability-contract.js";
import { createNetworkToolBundle } from "../mcp-server/src/network-tool-bundle.js";
import { NetworkToolRegistry } from "../mcp-server/src/tool-registry.js";

const workerSource = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
const workerRoutes = new Set(
  [...workerSource.matchAll(/app\.post\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
);

const contractTools = networkCapabilityContract.tools;
const contractRoutes = new Set(contractTools.map((tool) => tool.route));
const publicContractTools = contractTools.filter((tool) => tool.visibility !== "internal");

assert.equal(networkCapabilityContract.schemaVersion, 2, "Network contract schemaVersion must be 2");
assert.equal(networkCapabilityContract.boundary.browserOwner, "console-mcp", "Console MCP must remain the browser runtime owner");
assert.equal(networkCapabilityContract.boundary.executionOwner, "console-mcp", "Console MCP must own generic execution identity and lifecycle");
assert.equal(networkCapabilityContract.boundary.orchestrationOwner, "console-mcp", "Console MCP must own generic orchestration");
assert.equal(networkCapabilityContract.boundary.capabilityOwner, "network-mcp", "Network MCP must remain the capability owner");
assert.equal(networkCapabilityContract.boundary.domainStateOwner, "network-mcp", "Network MCP must own browser/form domain state");
assert.equal(networkCapabilityContract.boundary.genericAsyncLifecycleOwnedByNetwork, false, "Network must not own a duplicate generic async lifecycle");
assert.equal(networkCapabilityContract.boundary.genericExecutionLeaseOwnedByNetwork, false, "Network must not own duplicate generic execution leases");
assert.equal(networkCapabilityContract.boundary.competingBrowserLaunchAllowed, false, "Network must not launch a competing browser in Console-owned mode");
assert.equal(networkCapabilityContract.worker.browserAttachment, "console-owned-cdp", "Network must attach to the Console-owned browser over CDP");

for (const tool of contractTools) {
  assert.ok(workerRoutes.has(tool.route), `contract route is missing in worker runtime: ${tool.name} -> ${tool.route}`);
  assert.match(tool.inputSchemaId, /^network\..+\.input\.v1$/, `invalid input schema id: ${tool.name}`);
  assert.match(tool.resultSchemaId, /^network\..+\.result\.v1$/, `invalid result schema id: ${tool.name}`);
  assert.ok(["read", "write"].includes(tool.risk), `invalid coarse risk: ${tool.name}`);
  assert.ok(typeof tool.riskClass === "string" && tool.riskClass.length > 0, `missing riskClass: ${tool.name}`);
  assert.ok(["public", "internal"].includes(tool.visibility), `invalid visibility: ${tool.name}`);
  assert.ok(["optional", "required"].includes(tool.binding), `invalid binding: ${tool.name}`);
  assert.ok(typeof tool.replayPolicy === "string" && tool.replayPolicy.length > 0, `missing replayPolicy: ${tool.name}`);
  assert.ok(typeof tool.timeoutClass === "string" && tool.timeoutClass.length > 0, `missing timeoutClass: ${tool.name}`);
  assert.ok(typeof tool.postcondition === "string" && tool.postcondition.length > 0, `missing postcondition: ${tool.name}`);

  if (tool.requiresExplicitApproval) {
    assert.notEqual(tool.approvalPolicy, "none", `approval-required tool has no approval policy: ${tool.name}`);
  }
  if (tool.riskClass === "final-external-submit") {
    assert.equal(tool.requiresExplicitApproval, true, "final external submit must require explicit approval");
    assert.equal(tool.replayPolicy, "never-replay", "final external submit must never be replayed");
  }
}

for (const route of workerRoutes) {
  assert.ok(contractRoutes.has(route), `worker POST route is undocumented by the capability contract: ${route}`);
}

const registry = new NetworkToolRegistry("http://127.0.0.1:8791");
const expectedPublicNames = new Set([
  ...publicContractTools.map((tool) => tool.name),
  ...Object.keys(networkCapabilityAliases),
]);
assert.deepEqual(
  new Set(registry.listTools()),
  expectedPublicNames,
  "registry public surface must equal public contract tools plus canonical aliases",
);
assert.deepEqual(
  new Set(registry.listWorkerCapabilities()),
  new Set(contractTools.map((tool) => tool.name)),
  "registry worker capability surface must equal the full contract",
);

const registered = [];
createNetworkToolBundle({
  workerUrl: "http://127.0.0.1:8791",
  browserWorkerToken: "",
}).register({
  registerTool(name, config, handler) {
    registered.push({ name, config, handler });
  },
});

assert.deepEqual(
  new Set(registered.map((item) => item.name)),
  expectedPublicNames,
  "MCP bundle registration must equal the authoritative public contract surface",
);

for (const [alias, canonical] of Object.entries(networkCapabilityAliases)) {
  const aliasRegistration = registered.find((item) => item.name === alias);
  const canonicalRegistration = registered.find((item) => item.name === canonical);
  assert.ok(aliasRegistration && canonicalRegistration, `missing alias registration: ${alias} -> ${canonical}`);
  assert.equal(aliasRegistration.config, canonicalRegistration.config, `alias must reuse canonical MCP schema config: ${alias}`);
  assert.equal(aliasRegistration.handler, canonicalRegistration.handler, `alias must reuse canonical MCP handler: ${alias}`);
}

console.log(
  `Network capability symmetry passed: ${contractTools.length} contract tools, ${workerRoutes.size} worker routes, ${registered.length} public MCP registrations.`,
);

