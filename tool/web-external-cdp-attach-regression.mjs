import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");

for (const token of [
  "BROWSER_MCP_EXTERNAL_ATTACH_TIMEOUT_MS || 45000",
  "connectToExistingCdpEndpoint(endpoint, timeoutMs = 15000)",
  "policy.externalAttachTimeoutMs) ? policy.externalAttachTimeoutMs : 15000",
]) {
  assert.equal(worker.includes(token), true, `External CDP attach timeout invariant missing: ${token}`);
}

assert.equal(
  envExample.includes("BROWSER_MCP_EXTERNAL_ATTACH_TIMEOUT_MS=15000"),
  true,
  "Documented shared-browser attach timeout must match the worker default",
);

// An externally owned Edge must not be closed or force a worker restart
// solely because the worker's observation window elapsed.
const guard = worker.match(/async function assertSessionWindow\(policy\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
assert.match(guard, /if \(policy\.externalVisibleBrowser\) \{\s*sessionStartedAt = Date\.now\(\);\s*return;/);
assert.match(guard, /await closeSession\(\);\s*throw new Error/);
const externalBranch = guard.indexOf("if (policy.externalVisibleBrowser)");
const hardExpiry = guard.indexOf("await closeSession()");
assert.ok(externalBranch >= 0 && hardExpiry > externalBranch, "Visible browser lease rotation must precede managed-session hard expiry");

console.log("Web external CDP attach timeout regression passed.");

