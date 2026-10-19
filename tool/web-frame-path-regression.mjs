import assert from "node:assert/strict";
import fs from "node:fs";

import { enumerateFrameTree, resolveFrameByPath } from "../playwright-worker/src/frame-path.js";

function fakeFrame(name, url, children = []) {
  return {
    name: () => name,
    url: () => url,
    childFrames: () => children,
  };
}

const nested = fakeFrame("nested", "https://example.test/nested");
const childA = fakeFrame("a", "https://example.test/a");
const childB = fakeFrame("b", "https://example.test/b", [nested]);
const main = fakeFrame("", "https://example.test/", [childA, childB]);
const page = { mainFrame: () => main };

const tree = enumerateFrameTree(page);
assert.deepEqual(
  tree.map((entry) => entry.framePath),
  [[], [0], [1], [1, 0]],
);
assert.equal(tree[3].frameUrl, "https://example.test/nested");
assert.equal(tree[3].frameName, "nested");

assert.equal(resolveFrameByPath(page, []), main);
assert.equal(resolveFrameByPath(page, [0]), childA);
assert.equal(resolveFrameByPath(page, [1, 0]), nested);
assert.equal(resolveFrameByPath(page, [2]), null);
assert.throws(() => resolveFrameByPath(page, [-1]), /invalid child-frame index/);

const worker = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
for (const token of [
  "async function snapshotFieldsInFrame(frame, framePath, frameUrl, frameName)",
  "for (const frameInfo of enumerateFrameTree(target))",
  "framePath: [...framePath]",
  "localIndex: field.index",
  "semanticModelVersion: 4",
  "framePath,",
  "async function locatorForFieldSnapshot(target, field)",
  "const frame = resolveFrameByPath(target, framePath)",
  "'WEB_FRAME_STALE'",
  "await locatorForFieldSnapshot(target, field)",
  "const optionFrame = resolveFrameByPath(target, Array.isArray(field.framePath) ? field.framePath : []) ?? target.mainFrame()",
  "optionFrame.getByRole('option', { name: desired, exact: true })",
]) {
  assert.equal(worker.includes(token), true, `Iframe semantic-model invariant missing: ${token}`);
}

console.log("Web iframe frame-path regression passed.");

