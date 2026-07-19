export const SAFE_FIELD_TAGS = new Set(['input', 'textarea', 'select']);
export const UNSAFE_INPUT_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'image', 'reset']);
export const DEFAULT_WORKER_PORT = 8791;
export const DEFAULT_BROWSER_CHANNEL = 'msedge';
export const PLAYWRIGHT_BROWSER_CHANNELS = new Set(['chromium', 'chrome', 'msedge']);

export const JOB_BOARD_HOSTS = new Set([
  'job-boards.greenhouse.io',
  'boards.greenhouse.io',
  'jobs.lever.co',
  'ashbyhq.com',
  'jobs.ashbyhq.com',
  'workable.com',
  'bamboohr.com',
  'smartrecruiters.com',
  'myworkdayjobs.com'
]);

export const TRACKING_QUERY_PARAMS = new Set([
  'gh_src',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'ref',
  'src',
  'source',
  'trk'
]);

export function parseList(value) {
  return String(value || '')
    .split(/[,;\r\n]+/)
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeBrowserChannel(value) {
  const browserChannel = String(value || DEFAULT_BROWSER_CHANNEL).trim().toLowerCase();
  if (browserChannel === 'edge') {
    return 'msedge';
  }

  if (!PLAYWRIGHT_BROWSER_CHANNELS.has(browserChannel)) {
    throw new Error(`Unsupported NETWORK_MCP_BROWSER_CHANNEL "${browserChannel}". Use chromium, chrome, or msedge.`);
  }

  return browserChannel;
}

export function hostMatches(host, pattern) {
  return host === pattern || host.endsWith(`.${pattern}`);
}

export function isIPv4Address(host) {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }

  return parts.every(part => {
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const value = Number(part);
    if (part.length > 1 && part.startsWith('0')) {
      return false;
    }

    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

export function isBuiltInDeniedHost(host) {
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true;
  }

  if (host === 'metadata.google.internal' || host.endsWith('.metadata.google.internal')) {
    return true;
  }

  if (host === '0.0.0.0' || host === '::1') {
    return true;
  }

  if (isIPv4Address(host)) {
    const parts = host.split('.').map(part => Number(part));
    const [a, b] = parts;

    if (a === 127) {
      return true;
    }

    if (a === 10) {
      return true;
    }

    if (a === 169 && b === 254) {
      return true;
    }

    if (a === 192 && b === 168) {
      return true;
    }

    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
  }

  return false;
}

export function isAllowedHostOverride(host, policy) {
  return policy.allowedHosts.some(pattern => hostMatches(host, pattern));
}

export function isSafeEditableInputType(type) {
  return !UNSAFE_INPUT_TYPES.has(type);
}

export function isChallengeText(text) {
  return /captcha|2fa|two-factor|security check|challenge|bot detection|verify you are human|access denied/i.test(text);
}

export function isJobBoardHost(host) {
  return Array.from(JOB_BOARD_HOSTS).some(pattern => hostMatches(host, pattern));
}
