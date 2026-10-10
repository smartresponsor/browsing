import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  approvalPayloadHash,
  consumeApprovalReceipt,
  createApprovalReceipt,
  normalizeFillApprovalOperations,
} from "../playwright-worker/src/approval-receipt.js";
import { hashStableJson } from "../playwright-worker/src/revision-contract.js";

const root = await mkdtemp(path.join(os.tmpdir(), "web-approval-"));
try {
  const operations = normalizeFillApprovalOperations([
    { controlId: "control-a", value: "Alice" },
    { selector: "#role", value: "Engineer" },
  ]);
  const payloadHash = approvalPayloadHash(hashStableJson, operations);
  assert.equal(payloadHash, hashStableJson(operations));

  const receipt = await createApprovalReceipt({
    root,
    kind: "fill",
    targetId: "target-1",
    pageRevision: "page-1",
    formRevision: "form-1",
    payloadHash,
    ttlMs: 60_000,
  });

  assert.match(receipt.id, /^apr_[0-9a-f-]{36}$/i);
  assert.equal(receipt.kind, "fill");
  assert.equal(receipt.consumedAt, null);

  await assert.rejects(
    () => consumeApprovalReceipt({
      root,
      id: receipt.id,
      kind: "fill",
      targetId: "target-1",
      pageRevision: "page-1",
      formRevision: "form-1",
      payloadHash: "0".repeat(64),
    }),
    (error) => error?.webStatus === "WEB_APPROVAL_STALE",
  );

  const consumed = await consumeApprovalReceipt({
    root,
    id: receipt.id,
    kind: "fill",
    targetId: "target-1",
    pageRevision: "page-1",
    formRevision: "form-1",
    payloadHash,
  });
  assert.equal(consumed.id, receipt.id);
  assert.equal(typeof consumed.consumedAt, "string");

  await assert.rejects(
    () => consumeApprovalReceipt({
      root,
      id: receipt.id,
      kind: "fill",
      targetId: "target-1",
      pageRevision: "page-1",
      formRevision: "form-1",
      payloadHash,
    }),
    (error) => error?.webStatus === "WEB_APPROVAL_RECEIPT_REPLAYED",
  );

  const dynamicFillReceipt = await createApprovalReceipt({
    root,
    kind: "fill",
    targetId: "target-dynamic",
    pageRevision: "page-before-animation",
    formRevision: "form-stable",
    payloadHash,
    ttlMs: 60_000,
  });
  const dynamicConsumed = await consumeApprovalReceipt({
    root,
    id: dynamicFillReceipt.id,
    kind: "fill",
    targetId: "target-dynamic",
    pageRevision: "page-after-animation",
    formRevision: "form-stable",
    payloadHash,
    allowPageRevisionDriftWhenFormStable: true,
  });
  assert.equal(dynamicConsumed.id, dynamicFillReceipt.id);

  const staleReceipt = await createApprovalReceipt({
    root,
    kind: "submit",
    targetId: "target-2",
    pageRevision: "page-2",
    formRevision: "form-2",
    payloadHash: hashStableJson({ reviewHash: "review-a" }),
    ttlMs: 60_000,
  });
  await assert.rejects(
    () => consumeApprovalReceipt({
      root,
      id: staleReceipt.id,
      kind: "submit",
      targetId: "target-2",
      pageRevision: "page-changed",
      formRevision: "form-2",
      payloadHash: hashStableJson({ reviewHash: "review-a" }),
    }),
    (error) => error?.webStatus === "WEB_APPROVAL_STALE",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

const workerSource = fs.readFileSync(new URL("../playwright-worker/src/worker.js", import.meta.url), "utf8");
const definitionSource = fs.readFileSync(new URL("../mcp-server/src/web-domain-tool-definitions.cjs", import.meta.url), "utf8");

for (const token of [
  "const approvalReceipt = await createApprovalReceipt({",
  "await consumeApprovalReceipt({",
  "approvalReceiptId",
  "approvalPayloadHash(hashStableJson",
]) {
  assert.equal(workerSource.includes(token) || definitionSource.includes(token), true, `Approval receipt integration invariant missing: ${token}`);
}

console.log("Web approval receipt regression passed.");

