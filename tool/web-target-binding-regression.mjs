import assert from "node:assert/strict";
import fs from "node:fs";

const definitions = fs.readFileSync(new URL("../mcp-server/src/web-domain-tool-definitions.cjs", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");

for (const token of [
  "canonicalName: 'web.browser.bind'",
  "capabilityName: 'web.browser_bind'",
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
  "revisionError('WEB_TARGET_STALE'",
  "status: 'WEB_TARGET_BOUND'",
  "targetId: await getPageTargetId(page)",
  "sendWebError(res, error, 'WEB_TARGET_BIND_FAILED')",
]) {
  assert.equal(worker.includes(token), true, `Exact target binding invariant missing: ${token}`);
}

console.log("Web exact target binding regression passed.");

