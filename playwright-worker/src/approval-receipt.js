import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RECEIPT_ID_PATTERN = /^apr_[0-9a-f-]{36}$/i;

export async function createApprovalReceipt({
  root,
  kind,
  targetId,
  pageRevision,
  formRevision,
  payloadHash,
  ttlMs = 15 * 60 * 1000,
}) {
  const directory = path.resolve(String(root || '').trim());
  await mkdir(directory, { recursive: true });

  const now = Date.now();
  const boundedTtlMs = Math.min(Math.max(Number(ttlMs) || 0, 60_000), 60 * 60 * 1000);
  const id = `apr_${randomUUID()}`;
  const record = {
    schemaVersion: 1,
    id,
    kind: requireString(kind, 'kind'),
    targetId: requireString(targetId, 'targetId'),
    pageRevision: requireString(pageRevision, 'pageRevision'),
    formRevision: requireString(formRevision, 'formRevision'),
    payloadHash: requireHash(payloadHash),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + boundedTtlMs).toISOString(),
    consumedAt: null,
  };

  await writeFile(receiptPath(directory, id), JSON.stringify(record, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
  });

  return publicReceipt(record);
}

export async function consumeApprovalReceipt({
  root,
  id,
  kind,
  targetId,
  pageRevision,
  formRevision,
  payloadHash,
}) {
  const directory = path.resolve(String(root || '').trim());
  const receiptId = normalizeReceiptId(id);
  const filePath = receiptPath(directory, receiptId);

  let record;
  try {
    record = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (_error) {
    throw receiptError(
      'NETWORK_APPROVAL_RECEIPT_NOT_FOUND',
      'Approval receipt was not found. Request a fresh proposal or review receipt.',
      { approvalReceiptId: receiptId },
    );
  }

  validateRecord(record, {
    id: receiptId,
    kind,
    targetId,
    pageRevision,
    formRevision,
    payloadHash,
  });

  const lockPath = path.join(directory, `${receiptId}.consume.lock`);
  let lock;
  try {
    lock = await open(lockPath, 'wx');
    await lock.writeFile(JSON.stringify({
      id: receiptId,
      acquiredAt: new Date().toISOString(),
      pid: process.pid,
    }) + '\n', 'utf8');
  } catch (_error) {
    throw receiptError(
      'NETWORK_APPROVAL_RECEIPT_REPLAYED',
      'Approval receipt has already been consumed or consumption is already in progress.',
      { approvalReceiptId: receiptId },
    );
  } finally {
    await lock?.close().catch(() => {});
  }

  const consumedRecord = {
    ...record,
    consumedAt: new Date().toISOString(),
  };
  const tempPath = path.join(directory, `.${receiptId}.${process.pid}.tmp`);
  await writeFile(tempPath, JSON.stringify(consumedRecord, null, 2) + '\n', 'utf8');
  await rename(tempPath, filePath);

  return publicReceipt(consumedRecord);
}

export function approvalPayloadHash(hashStableJson, value) {
  if (typeof hashStableJson !== 'function') {
    throw new TypeError('hashStableJson function is required.');
  }
  return hashStableJson(value);
}

export function normalizeFillApprovalOperations(fields) {
  return (Array.isArray(fields) ? fields : []).map((item) => ({
    controlId: normalizeOptionalString(item?.controlId),
    index: Number.isInteger(item?.index) ? item.index : null,
    selector: normalizeOptionalString(item?.selector),
    value: item?.value ?? '',
  }));
}

function validateRecord(record, expected) {
  if (!record || typeof record !== 'object' || record.schemaVersion !== 1) {
    throw receiptError('NETWORK_APPROVAL_RECEIPT_INVALID', 'Approval receipt record is invalid.');
  }
  if (record.id !== expected.id) {
    throw receiptError('NETWORK_APPROVAL_RECEIPT_INVALID', 'Approval receipt identity does not match its record.');
  }
  if (record.consumedAt) {
    throw receiptError(
      'NETWORK_APPROVAL_RECEIPT_REPLAYED',
      'Approval receipt was already consumed.',
      { approvalReceiptId: expected.id, consumedAt: record.consumedAt },
    );
  }
  if (Date.parse(record.expiresAt) <= Date.now()) {
    throw receiptError(
      'NETWORK_APPROVAL_RECEIPT_EXPIRED',
      'Approval receipt expired. Request a fresh proposal or review receipt.',
      { approvalReceiptId: expected.id, expiresAt: record.expiresAt },
    );
  }

  const checks = [
    ['kind', requireString(expected.kind, 'kind')],
    ['targetId', requireString(expected.targetId, 'targetId')],
    ['pageRevision', requireString(expected.pageRevision, 'pageRevision')],
    ['formRevision', requireString(expected.formRevision, 'formRevision')],
    ['payloadHash', requireHash(expected.payloadHash)],
  ];
  for (const [key, value] of checks) {
    if (record[key] !== value) {
      throw receiptError(
        'NETWORK_APPROVAL_STALE',
        `Approval receipt no longer matches current ${key}.`,
        { approvalReceiptId: expected.id, mismatch: key },
      );
    }
  }
}

function normalizeReceiptId(value) {
  const id = String(value || '').trim();
  if (!RECEIPT_ID_PATTERN.test(id)) {
    throw receiptError(
      'NETWORK_APPROVAL_RECEIPT_REQUIRED',
      'A valid approvalReceiptId is required. Request a fresh proposal or review receipt.',
    );
  }
  return id;
}

function receiptPath(root, id) {
  return path.join(root, `${id}.json`);
}

function publicReceipt(record) {
  return {
    id: record.id,
    kind: record.kind,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    consumedAt: record.consumedAt,
  };
}

function requireString(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw receiptError('NETWORK_APPROVAL_RECEIPT_INVALID', `${name} is required for approval receipt binding.`);
  }
  return normalized;
}

function requireHash(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw receiptError('NETWORK_APPROVAL_RECEIPT_INVALID', 'Approval payload hash must be a SHA-256 hex string.');
  }
  return normalized;
}

function normalizeOptionalString(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function receiptError(status, message, evidence = {}) {
  const error = new Error(message);
  error.networkStatus = status;
  error.evidence = evidence;
  return error;
}

