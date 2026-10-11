import assert from "node:assert/strict";
import fs from "node:fs";

import {
  getWebCapabilityAdmission,
  webCapabilityAdmissions,
  webCapabilityAliases,
  webCapabilityContract,
} from "../mcp-server/src/capability-contract.js";
import { createWebToolBundle } from "../mcp-server/src/web-tool-bundle.js";
import { createWebCoreDomainToolDefinitions } from "../mcp-server/src/web-domain-tool-definitions.js";
import { WebToolRegistry } from "../mcp-server/src/tool-registry.js";

const workerSource = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
const workerRoutes = new Set(
  [...workerSource.matchAll(/app\.post\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
);

const contractTools = webCapabilityContract.tools;
const contractRoutes = new Set(contractTools.map((tool) => tool.route));
const publicContractTools = contractTools.filter((tool) => tool.visibility !== "internal");

assert.equal(webCapabilityContract.schemaVersion, 2, "Web contract schemaVersion must be 2");
assert.equal(webCapabilityContract.boundary.browserOwner, "console-mcp", "Console MCP must remain the browser runtime owner");
assert.equal(webCapabilityContract.boundary.executionOwner, "console-mcp", "Console MCP must own generic execution identity and lifecycle");
assert.equal(webCapabilityContract.boundary.orchestrationOwner, "console-mcp", "Console MCP must own generic orchestration");
assert.equal(webCapabilityContract.boundary.capabilityOwner, "browser-mcp", "Browser MCP must remain the capability owner");
assert.equal(webCapabilityContract.boundary.domainStateOwner, "browser-mcp", "Browser MCP must own browser/form domain state");
assert.equal(webCapabilityContract.boundary.genericAsyncLifecycleOwnedByWeb, false, "Web must not own a duplicate generic async lifecycle");
assert.equal(webCapabilityContract.boundary.genericExecutionLeaseOwnedByWeb, false, "Web must not own duplicate generic execution leases");
assert.equal(webCapabilityContract.boundary.competingBrowserLaunchAllowed, false, "Web must not launch a competing browser in Console-owned mode");
assert.equal(webCapabilityContract.worker.browserAttachment, "console-owned-cdp", "Web must attach to the Console-owned browser over CDP");

for (const tool of contractTools) {
  assert.ok(workerRoutes.has(tool.route), `contract route is missing in worker runtime: ${tool.name} -> ${tool.route}`);
  assert.match(tool.inputSchemaId, /^web\..+\.input\.v1$/, `invalid input schema id: ${tool.name}`);
  assert.match(tool.resultSchemaId, /^web\..+\.result\.v1$/, `invalid result schema id: ${tool.name}`);
  assert.ok(["read", "write"].includes(tool.risk), `invalid coarse risk: ${tool.name}`);
  assert.equal(tool.admission?.name, tool.name, `admission name drift: ${tool.name}`);
  assert.ok(["atomic", "domainCapability", "recipe", "orchestrationControl", "runtimeMaintenance"].includes(tool.admission?.kind), `invalid admission kind: ${tool.name}`);
  assert.equal(tool.admission?.risk, tool.risk === "read" ? "read_" : "write", `admission risk drift: ${tool.name}`);
  assert.deepEqual(tool.admission?.consumers, ["chatgpt", "codex", "runner"], `consumer projection drift: ${tool.name}`);
  assert.equal(tool.admission?.lifecycle, "admitted", `Web capability must be admitted: ${tool.name}`);
  assert.equal(webCapabilityAdmissions[tool.name], tool.admission, `admission registry drift: ${tool.name}`);
  assert.equal(getWebCapabilityAdmission(tool.name), tool.admission, `admission lookup drift: ${tool.name}`);
  assert.ok(typeof tool.riskClass === "string" && tool.riskClass.length > 0, `missing riskClass: ${tool.name}`);
  assert.ok(["public", "internal"].includes(tool.visibility), `invalid visibility: ${tool.name}`);
  assert.ok(["optional", "required"].includes(tool.binding), `invalid binding: ${tool.name}`);
  assert.ok(typeof tool.replayPolicy === "string" && tool.replayPolicy.length > 0, `missing replayPolicy: ${tool.name}`);
  assert.ok(typeof tool.timeoutClass === "string" && tool.timeoutClass.length > 0, `missing timeoutClass: ${tool.name}`);
  assert.ok(["none", "console-owned-optional"].includes(tool.executionCorrelation), `invalid executionCorrelation: ${tool.name}`);
  assert.ok(["none", "mints-fill-one-time", "consumes-fill-one-time", "mints-submit-one-time", "consumes-submit-one-time"].includes(tool.approvalReceiptBehavior), `invalid approvalReceiptBehavior: ${tool.name}`);
  assert.ok(typeof tool.postcondition === "string" && tool.postcondition.length > 0, `missing postcondition: ${tool.name}`);

  if (tool.requiresExplicitApproval) {
    assert.notEqual(tool.approvalPolicy, "none", `approval-required tool has no approval policy: ${tool.name}`);
  }
  if (tool.riskClass === "final-external-submit") {
    assert.equal(tool.requiresExplicitApproval, true, "final external submit must require explicit approval");
    assert.equal(tool.replayPolicy, "never-replay", "final external submit must never be replayed");
  }
}

assert.throws(
  () => getWebCapabilityAdmission("web.unknown_capability"),
  /not admitted/,
  "declaration-less Web capabilities must fail closed",
);

for (const route of workerRoutes) {
  assert.ok(contractRoutes.has(route), `worker POST route is undocumented by the capability contract: ${route}`);
}

for (const [toolName, behavior] of [
  ["web.propose", "mints-fill-one-time"],
  ["web.fill_after_approval", "consumes-fill-one-time"],
  ["web.review_before_submit", "mints-submit-one-time"],
  ["web.submit_after_approval", "consumes-submit-one-time"],
]) {
  const tool = contractTools.find((candidate) => candidate.name === toolName);
  assert.equal(tool?.approvalReceiptBehavior, behavior, `approval receipt behavior mismatch: ${toolName}`);
}

for (const toolName of [
  "web.click",
  "web.fill_after_approval",
  "web.upload_artifact",
  "web.submit_after_approval",
]) {
  const tool = contractTools.find((candidate) => candidate.name === toolName);
  assert.equal(tool?.executionCorrelation, "console-owned-optional", `critical mutation must accept Console-owned execution correlation: ${toolName}`);
}

const registry = new WebToolRegistry("http://127.0.0.1:8791");
const coreDomainPublicNames = createWebCoreDomainToolDefinitions().flatMap((tool) => [tool.canonicalName, ...tool.aliases]);
const expectedPublicNames = new Set([
  ...publicContractTools.map((tool) => tool.name),
  ...Object.keys(webCapabilityAliases),
  ...coreDomainPublicNames,
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
createWebToolBundle({
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

for (const tool of createWebCoreDomainToolDefinitions()) {
  const canonicalRegistration = registered.find((item) => item.name === tool.canonicalName);
  assert.ok(canonicalRegistration, `missing canonical Browser MCP registration: ${tool.canonicalName}`);
  for (const alias of tool.aliases) {
    const aliasRegistration = registered.find((item) => item.name === alias);
    assert.ok(aliasRegistration, `missing supported legacy alias: ${alias} -> ${tool.canonicalName}`);
    assert.equal(aliasRegistration.config, canonicalRegistration.config, `legacy alias must reuse canonical MCP schema config: ${alias}`);
    assert.equal(aliasRegistration.handler, canonicalRegistration.handler, `legacy alias must reuse canonical MCP handler: ${alias}`);
  }
}

console.log(
  `Web capability symmetry passed: ${contractTools.length} contract tools, ${workerRoutes.size} worker routes, ${registered.length} public MCP registrations.`,
);

