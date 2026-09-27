import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ALLOWED_EXTENSIONS = Object.freeze([
  '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.png', '.jpg', '.jpeg'
]);

const MIME_BY_EXTENSION = Object.freeze({
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
});

export async function resolveGuardedUploadArtifact({
  artifactRef,
  uploadRoot,
  expectedSha256 = '',
  maxBytes = 25 * 1024 * 1024,
  allowedExtensions = DEFAULT_ALLOWED_EXTENSIONS
}) {
  const normalizedRef = normalizeArtifactRef(artifactRef);
  const normalizedExpectedSha256 = normalizeExpectedSha256(expectedSha256);
  const boundedMaxBytes = normalizeMaxBytes(maxBytes);

  const configuredRoot = path.resolve(String(uploadRoot || '').trim());
  const rootRealPath = await realpath(configuredRoot).catch(() => {
    throw uploadError(
      'NETWORK_UPLOAD_ROOT_UNAVAILABLE',
      'The configured upload artifact root does not exist or is not accessible.',
      { uploadRoot: configuredRoot }
    );
  });

  const candidatePath = path.resolve(rootRealPath, normalizedRef);
  assertInsideRoot(candidatePath, rootRealPath, normalizedRef);

  const artifactRealPath = await realpath(candidatePath).catch(() => {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_NOT_FOUND',
      'The requested upload artifact was not found in the dedicated artifact root.',
      { artifactRef: normalizedRef }
    );
  });
  assertInsideRoot(artifactRealPath, rootRealPath, normalizedRef);

  const info = await stat(artifactRealPath);
  if (!info.isFile()) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_INVALID',
      'The upload artifact reference must resolve to a regular file.',
      { artifactRef: normalizedRef }
    );
  }
  if (info.size <= 0) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_INVALID',
      'The upload artifact is empty.',
      { artifactRef: normalizedRef }
    );
  }
  if (info.size > boundedMaxBytes) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_TOO_LARGE',
      'The upload artifact exceeds the configured size limit.',
      { artifactRef: normalizedRef, size: info.size, maxBytes: boundedMaxBytes }
    );
  }

  const extension = path.extname(artifactRealPath).toLowerCase();
  const normalizedAllowedExtensions = new Set(
    allowedExtensions.map(item => normalizeExtension(item)).filter(Boolean)
  );
  if (!normalizedAllowedExtensions.has(extension)) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_TYPE_BLOCKED',
      'The upload artifact extension is not allowed.',
      { artifactRef: normalizedRef, extension, allowedExtensions: [...normalizedAllowedExtensions] }
    );
  }

  const buffer = await readFile(artifactRealPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  if (normalizedExpectedSha256 && normalizedExpectedSha256 !== sha256) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_HASH_MISMATCH',
      'The upload artifact SHA-256 does not match the expected hash.',
      { artifactRef: normalizedRef, expectedSha256: normalizedExpectedSha256, actualSha256: sha256 }
    );
  }

  const filename = path.basename(artifactRealPath);
  return {
    filePath: artifactRealPath,
    artifact: {
      artifactRef: normalizedRef,
      filename,
      size: info.size,
      sha256,
      mime: MIME_BY_EXTENSION[extension] || 'application/octet-stream',
      extension
    }
  };
}

export function normalizeArtifactRef(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    throw uploadError('NETWORK_UPLOAD_ARTIFACT_REF_REQUIRED', 'artifactRef is required.');
  }
  if (raw.includes('\0')) {
    throw uploadError('NETWORK_UPLOAD_ARTIFACT_REF_INVALID', 'artifactRef contains a null byte.');
  }
  if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw)) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_REF_INVALID',
      'artifactRef must be relative to the dedicated upload artifact root.',
      { artifactRef: raw }
    );
  }

  const segments = raw.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0 || segments.some(segment => segment === '..' || segment === '.')) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_REF_INVALID',
      'artifactRef contains an unsafe traversal segment.',
      { artifactRef: raw }
    );
  }

  return segments.join(path.sep);
}

export function uploadError(status, message, evidence = {}) {
  const error = new Error(message);
  error.networkStatus = status;
  error.evidence = evidence;
  return error;
}

function assertInsideRoot(candidatePath, rootPath, artifactRef) {
  const rootPrefix = rootPath.endsWith(path.sep) ? rootPath : `${rootPath}${path.sep}`;
  if (candidatePath !== rootPath && !candidatePath.startsWith(rootPrefix)) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_REF_INVALID',
      'The upload artifact resolved outside the dedicated artifact root.',
      { artifactRef }
    );
  }
}

function normalizeExpectedSha256(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw uploadError(
      'NETWORK_UPLOAD_ARTIFACT_HASH_INVALID',
      'expectedSha256 must be a 64-character lowercase/uppercase hexadecimal SHA-256 value.'
    );
  }
  return normalized;
}

function normalizeMaxBytes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 25 * 1024 * 1024;
  }
  return Math.min(Math.max(Math.trunc(numeric), 1024), 100 * 1024 * 1024);
}

function normalizeExtension(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

