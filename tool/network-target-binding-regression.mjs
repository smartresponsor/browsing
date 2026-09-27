import assert from "node:assert/strict";
import fs from "node:fs";

const definitions = fs.readFileSync(new URL("../mcp-server/src/core-domain-tool-definitions.cjs", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "canonicalName: 'network.browser_bind'",
  "capabilityName: 'network.browser_bind'",
  "targetId: z.string().min(1).optional()",
]) {
  assert.equal(definitions.includes(token), true, `Target binding definition invariant missing: ${token}`);
}

for (const token of [
  "targetId: closed ? null : await getPageTargetId(item)",
  "activeTargetId: active?.targetId ?? null",
  "async function bindBrowserTarget({ targetId, index, url, urlContains } = {})",
  "if (targetId) {",
  "await getPageTargetId(candidate) === String(targetId)",
  "revisionError('NETWORK_TARGET_STALE'",
  "status: 'NETWORK_TARGET_BOUND'",
  "targetId: await getPageTargetId(page)",
  "sendNetworkError(res, error, 'NETWORK_TARGET_BIND_FAILED')",
]) {
  assert.equal(worker.includes(token), true, `Exact target binding invariant missing: ${token}`);
}

console.log("Network exact target binding regression passed.");

