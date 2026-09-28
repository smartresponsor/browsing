import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");

for (const token of [
  "NETWORK_MCP_EXTERNAL_ATTACH_TIMEOUT_MS || 15000",
  "connectToExistingCdpEndpoint(endpoint, timeoutMs = 15000)",
  "policy.externalAttachTimeoutMs) ? policy.externalAttachTimeoutMs : 15000",
]) {
  assert.equal(worker.includes(token), true, `External CDP attach timeout invariant missing: ${token}`);
}

assert.equal(
  envExample.includes("NETWORK_MCP_EXTERNAL_ATTACH_TIMEOUT_MS=15000"),
  true,
  "Documented shared-browser attach timeout must match the worker default",
);

console.log("Network external CDP attach timeout regression passed.");

