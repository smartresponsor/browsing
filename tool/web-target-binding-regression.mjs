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
  "targetId: item.id",
  "activeTargetId,",
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

const inventoryFunction = worker.slice(worker.indexOf("async function listBrowserTargets()"), worker.indexOf("async function bindBrowserTarget("));
assert.equal(inventoryFunction.includes("await ensurePage()"), false, "Read-only target inventory must never attach, navigate or launch a browser");
assert.equal(inventoryFunction.includes("listRawCdpTargets(getPolicy())"), true, "Inventory must retain native target identity even without an automation binding");
const bindFunction = worker.slice(worker.indexOf("async function bindBrowserTarget("), worker.indexOf("async function waitForReadiness("));
assert.equal(bindFunction.includes("if (!selected && targetId && getPolicy().externalVisibleChrome)"), true, "Exact target recovery must be limited to shared CDP mode");
assert.equal(bindFunction.includes("await connectExternalVisibleChrome("), true, "Recovery must reattach to the existing CDP endpoint");
assert.equal(bindFunction.includes("await getPageTargetId(candidate) === String(targetId)"), true, "Recovered page must match exact target identity");
assert.equal(bindFunction.includes("await recovered.connectedBrowser.close().catch(() => {})"), true, "Unmatched recovery connection must be released");
assert.equal(bindFunction.includes("launchPersistentContext"), false, "Binding recovery must not launch another browser");
// Execute the actual binding function with mocked CDP connections; no Edge access.
const targetId = "A".repeat(32);
const events = [];
const mockPage = id => ({ id, isClosed: () => false, url: () => "https://example.test/", title: async () => "Test", bringToFront: async () => events.push("foreground") });
const recoveredPage = mockPage(targetId);
const oldConnection = { close: async () => events.push("old-closed") };
const recoveredConnection = { close: async () => events.push("recovered-closed") };
const sandbox = {
  browser: { pages: () => [mockPage("B".repeat(32))] },
  connectedBrowser: oldConnection, page: null,
  ensurePage: async () => {},
  getPolicy: () => ({ externalVisibleChrome: true }),
  getManagedUserDataDir: () => "unused",
  connectExternalVisibleChrome: async () => ({ connectedBrowser: recoveredConnection, context: { pages: () => [recoveredPage] } }),
  getPageTargetId: async page => page.id,
  revisionError: (status, message) => Object.assign(new Error(message), { webStatus: status }),
};
const { runInNewContext } = await import("node:vm");
runInNewContext(bindFunction + "\nthis.runBind = bindBrowserTarget;", sandbox);
const result = await sandbox.runBind({ targetId });
assert.equal(result.status, "WEB_TARGET_BOUND");
assert.equal(result.bound.targetId, targetId);
assert.equal(sandbox.connectedBrowser, recoveredConnection);
assert.equal(events.includes("old-closed"), false, "Do not close old CDP connection before lifecycle review");
sandbox.browser = { pages: () => [mockPage("B".repeat(32))] };
sandbox.connectedBrowser = oldConnection;
sandbox.connectExternalVisibleChrome = async () => ({ connectedBrowser: recoveredConnection, context: { pages: () => [mockPage("C".repeat(32))] } });
await assert.rejects(sandbox.runBind({ targetId }), error => error.webStatus === "WEB_TARGET_STALE");
assert.equal(events.includes("recovered-closed"), true, "Unmatched recovery connection must be released");
assert.equal(sandbox.connectedBrowser, oldConnection, "Failed recovery must preserve original binding");

console.log("Web exact target binding regression passed.");

