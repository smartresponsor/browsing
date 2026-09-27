import assert from "node:assert/strict";
import fs from "node:fs";

const bundle = fs.readFileSync(new URL("../mcp-server/src/network-tool-bundle.js", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "targetId: z.string().min(1).optional()",
  "async ({ targetId, index, url, urlContains })",
  "registry.callTool('network.browser_bind', { targetId, index, url, urlContains })",
]) {
  assert.equal(bundle.includes(token), true, `Target binding schema invariant missing: ${token}`);
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

