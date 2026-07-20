function normalizeError(error) {
  if (!error) {
    return '';
  }

  return error instanceof Error ? error.message : String(error);
}

export function classifyRawCdpTarget(target) {
  const type = typeof target?.type === 'string' ? target.type : '';
  const rawUrl = typeof target?.url === 'string' ? target.url : '';
  let url = null;
  try {
    url = new URL(rawUrl);
  } catch (_error) {
    url = null;
  }

  const host = url?.hostname.toLowerCase() || '';
  const isChatGpt = host === 'chatgpt.com' || host.endsWith('.chatgpt.com');
  const isPage = type === 'page';
  const isChatGptHome = Boolean(isPage && isChatGpt && url.pathname === '/' && !url.search && !url.hash);
  const isChatGptConversation = Boolean(isPage && isChatGpt && /^\/c\/[^/]+/.test(url.pathname));

  return {
    isChatGpt,
    isPage,
    isChatGptHome,
    isChatGptConversation,
    category: isChatGptHome
      ? 'chatgpt-home'
      : isChatGptConversation
        ? 'chatgpt-conversation'
        : isChatGpt
          ? 'chatgpt-other'
          : type || 'unknown',
    rawCleanupCandidate: isChatGptHome,
    cleanupSafety: isChatGptHome ? 'raw-candidate-only-dom-not-verified' : 'not-candidate'
  };
}

export async function evaluateRawCdpTarget(target, expression, timeoutMs = 5000) {
  const webSocketDebuggerUrl = String(target?.webSocketDebuggerUrl || '').trim();
  if (!webSocketDebuggerUrl) {
    throw new Error('Target does not expose webSocketDebuggerUrl.');
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let socket = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket?.close(); } catch (_error) {}
      reject(new Error(`Timed out while evaluating raw CDP target after ${timeoutMs} ms.`));
    }, Math.max(250, timeoutMs));

    function finish(callback, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch (_error) {}
      callback(value);
    }

    try {
      socket = new WebSocket(webSocketDebuggerUrl);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        }));
      });
      socket.addEventListener('message', event => {
        let payload = null;
        try { payload = JSON.parse(String(event.data || '')); } catch (_error) { return; }
        if (payload?.id !== 1) return;
        if (payload.error) {
          finish(reject, new Error(payload.error.message || 'Raw CDP Runtime.evaluate failed.'));
          return;
        }
        const exceptionText = payload?.result?.exceptionDetails?.text;
        if (exceptionText) {
          finish(reject, new Error(exceptionText));
          return;
        }
        finish(resolve, payload?.result?.result?.value ?? null);
      });
      socket.addEventListener('error', () => finish(reject, new Error('Raw CDP target WebSocket failed.')));
    } catch (error) {
      finish(reject, error);
    }
  });
}

function buildChatGptHomeVerificationExpression() {
  return `(() => {
    const normalize = value => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = node => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0;
    };
    const selectors = ['#prompt-textarea', '[data-testid="composer-root"] textarea', 'textarea', '[contenteditable="true"]', '.ProseMirror'];
    const nodes = Array.from(new Set(selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)))));
    const composerNodes = nodes.filter(visible).map((node, index) => ({
      index,
      tag: node.tagName.toLowerCase(),
      id: node.id || '',
      ariaLabel: node.getAttribute('aria-label') || '',
      text: normalize(node.value || node.innerText || node.textContent || ''),
      placeholder: node.getAttribute('placeholder') || ''
    }));
    const composerText = normalize(composerNodes.map(item => item.text).join(' '));
    const buttons = Array.from(document.querySelectorAll('button')).filter(visible).map(button => normalize(button.innerText || button.textContent || button.getAttribute('aria-label') || '')).filter(Boolean).slice(0, 80);
    const isStreaming = buttons.some(text => /stop|cancel|pause/i.test(text)) || Boolean(document.querySelector('[data-testid*="stop"], [aria-label*="Stop"], [aria-label*="stop"]'));
    const pathname = window.location.pathname || '';
    const isConversation = /^\\/c\\/[^/]+/.test(pathname);
    const isHomeUrl = window.location.hostname === 'chatgpt.com' && pathname === '/' && !window.location.search && !window.location.hash;
    return {
      ok: true,
      url: window.location.href || '',
      title: document.title || '',
      pathname,
      isHomeUrl,
      isConversation,
      composerNodeCount: composerNodes.length,
      composerTextLength: composerText.length,
      composerTextPreview: composerText.slice(0, 200),
      isStreaming,
      buttonTexts: buttons,
      verifiedEmptyHome: Boolean(isHomeUrl && !isConversation && composerText.length === 0 && !isStreaming),
      safety: 'read-only-dom-verification-no-write-no-click-no-close'
    };
  })()`;
}

export async function verifyChatGptHomeTarget(target, timeoutMs = 5000) {
  const classification = target?.classification || classifyRawCdpTarget(target);
  if (!classification.isChatGptHome) {
    return {
      ok: true,
      verifiedEmptyHome: false,
      reason: 'not-chatgpt-home-candidate',
      target: { index: target.index, id: target.id, url: target.url, title: target.title },
      classification
    };
  }

  const dom = await evaluateRawCdpTarget(target, buildChatGptHomeVerificationExpression(), timeoutMs);
  return {
    ok: Boolean(dom?.ok),
    verifiedEmptyHome: Boolean(dom?.verifiedEmptyHome),
    reason: dom?.verifiedEmptyHome ? 'verified-empty-chatgpt-home' : 'dom-verification-not-empty-or-unsafe',
    target: { index: target.index, id: target.id, url: target.url, title: target.title },
    classification,
    dom
  };
}

export function compactRawCdpTarget(target) {
  return {
    index: target.index,
    id: target.id,
    type: target.type,
    title: target.title,
    url: target.url,
    category: target.classification?.category || target.category || 'unknown',
    hasWebSocketDebuggerUrl: Boolean(target.webSocketDebuggerUrl)
  };
}

async function closeRawCdpTarget(policy, target, timeoutMs = 5000) {
  const targetId = String(target?.id || '').trim();
  if (!targetId) throw new Error('Target id is required for raw CDP close.');
  const endpoint = `http://127.0.0.1:${policy.remoteDebuggingPort}`;
  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 250), 10000) : 5000;
  const closePath = ['/json', 'close', encodeURIComponent(targetId)].join('/');
  const response = await fetch(`${endpoint}${closePath}`, { signal: AbortSignal.timeout(boundedTimeoutMs) });
  const body = await response.text();
  return { ok: response.ok, status: response.status, target: compactRawCdpTarget(target), body: body.slice(0, 500) };
}

export async function buildChatGptHomeCleanupPlan(policy, { maxVerify = 20, maxClose = 10, timeoutMs = 5000 } = {}) {
  const inventory = await listRawCdpTargets(policy);
  const boundedMaxVerify = Number.isInteger(maxVerify) ? Math.min(Math.max(maxVerify, 1), 50) : 20;
  const boundedMaxClose = Number.isInteger(maxClose) ? Math.min(Math.max(maxClose, 1), 50) : 10;
  const boundedTimeoutMs = Number.isInteger(timeoutMs) ? Math.min(Math.max(timeoutMs, 250), 10000) : 5000;
  const rawCandidates = inventory.targets.filter(target => target.classification.rawCleanupCandidate).slice(0, boundedMaxVerify);
  const verification = [];

  for (const target of rawCandidates) {
    try {
      verification.push(await verifyChatGptHomeTarget(target, boundedTimeoutMs));
    } catch (error) {
      verification.push({
        ok: false,
        verifiedEmptyHome: false,
        reason: 'dom-verification-error',
        target: compactRawCdpTarget(target),
        classification: target.classification,
        error: normalizeError(error)
      });
    }
  }

  const verifiedById = new Map(verification.map(item => [item.target?.id, item]));
  const verifiedCloseCandidates = verification.filter(item => item.ok === true && item.verifiedEmptyHome === true);
  const selectedForClose = verifiedCloseCandidates.slice(0, boundedMaxClose);
  const selectedIds = new Set(selectedForClose.map(item => item.target?.id).filter(Boolean));
  const verifiedIds = new Set(verification.map(item => item.target?.id).filter(Boolean));
  const wouldClose = selectedForClose.map(item => ({
    ...item.target,
    reason: item.reason,
    dom: {
      isHomeUrl: item.dom?.isHomeUrl === true,
      isConversation: item.dom?.isConversation === true,
      composerTextLength: Number(item.dom?.composerTextLength || 0),
      isStreaming: item.dom?.isStreaming === true,
      safety: item.dom?.safety || null
    }
  }));
  const wouldKeep = inventory.targets
    .filter(target => !selectedIds.has(target.id))
    .map(target => {
      const verified = verifiedById.get(target.id);
      return {
        ...compactRawCdpTarget(target),
        reason: target.classification.isChatGptConversation
          ? 'keep-chatgpt-conversation'
          : target.classification.isChatGpt && !target.classification.isChatGptHome
            ? 'keep-chatgpt-non-home'
            : target.classification.isChatGptHome && !verifiedIds.has(target.id)
              ? 'keep-unverified-beyond-max-verify'
              : verified && verified.verifiedEmptyHome !== true
                ? verified.reason
                : target.classification.isChatGptHome
                  ? 'keep-not-selected-by-max-close'
                  : 'keep-non-chatgpt-or-non-page'
      };
    });

  return {
    ok: true,
    service: 'network-mcp-browser-worker',
    action: 'browser_cdp_cleanup_plan_chatgpt_home',
    mode: 'dry-run',
    requested: { maxVerify: boundedMaxVerify, maxClose: boundedMaxClose, timeoutMs: boundedTimeoutMs },
    inventoryBefore: {
      count: inventory.count,
      chatGptInventory: inventory.chatGptInventory
    },
    rawCandidateCount: inventory.chatGptInventory.rawCleanupCandidateCount,
    verifiedCount: verification.length,
    verifiedEmptyHomeCount: verifiedCloseCandidates.length,
    wouldCloseCount: wouldClose.length,
    wouldKeepCount: wouldKeep.length,
    wouldClose,
    wouldKeep,
    verification,
    policy: {
      browserMutation: false,
      closesTabs: false,
      dryRunOnly: true,
      requiresConfirmedCleanupTool: true,
      neverCloseConversationTabs: true,
      neverCloseDraftOrStreamingTabs: true
    },
    safety: 'read-only-cleanup-plan-no-close-no-click-no-write-no-playwright-attach'
  };
}

export async function cleanupChatGptHomeTargets(policy, { confirmCleanup = false, maxVerify = 20, maxClose = 10, timeoutMs = 5000 } = {}) {
  const plan = await buildChatGptHomeCleanupPlan(policy, { maxVerify, maxClose, timeoutMs });
  if (confirmCleanup !== true) {
    return {
      ok: false,
      status: 'CONFIRM_CLEANUP_REQUIRED',
      mode: 'blocked',
      willCloseCount: plan.wouldCloseCount,
      plan,
      policy: {
        browserMutation: true,
        requiresConfirmCleanup: true,
        closesVerifiedEmptyHomeTabsOnly: true,
        maxCloseDefault: 10,
        postCleanupInventoryRequired: true
      }
    };
  }

  const beforeConversationCount = Number(plan.inventoryBefore.chatGptInventory.chatGptConversationTargetCount || 0);
  const closed = [];
  for (const item of plan.wouldClose) {
    const source = plan.verification.find(candidate => candidate.target?.id === item.id);
    const target = source?.target ? { ...source.target, type: item.type, webSocketDebuggerUrl: '' } : item;
    try {
      closed.push(await closeRawCdpTarget(policy, target, plan.requested.timeoutMs));
    } catch (error) {
      closed.push({ ok: false, target: item, error: normalizeError(error) });
    }
  }

  const after = await listRawCdpTargets(policy);
  const afterConversationCount = Number(after.chatGptInventory.chatGptConversationTargetCount || 0);
  const conversationCountPreserved = afterConversationCount >= beforeConversationCount;
  const ok = closed.every(item => item.ok === true) && conversationCountPreserved;
  return {
    ok,
    status: ok ? 'CHATGPT_HOME_CLEANUP_DONE' : 'CHATGPT_HOME_CLEANUP_GUARD_FAILED',
    mode: 'confirmed',
    closedCount: closed.filter(item => item.ok === true).length,
    requestedCloseCount: plan.wouldCloseCount,
    closed,
    before: plan.inventoryBefore,
    after: { count: after.count, chatGptInventory: after.chatGptInventory },
    guard: {
      beforeConversationCount,
      afterConversationCount,
      conversationCountPreserved
    },
    plan,
    policy: {
      browserMutation: true,
      requiresConfirmCleanup: true,
      closesVerifiedEmptyHomeTabsOnly: true,
      neverCloseConversationTabs: true,
      neverCloseDraftOrStreamingTabs: true,
      postCleanupInventoryRequired: true
    }
  };
}

export async function listRawCdpTargets(policy) {
  const endpoint = `http://127.0.0.1:${policy.remoteDebuggingPort}`;
  const timeoutMs = Number.isFinite(policy.externalAttachTimeoutMs) ? policy.externalAttachTimeoutMs : 5000;
  const response = await fetch(`${endpoint}/json/list`, {
    signal: AbortSignal.timeout(Math.max(250, timeoutMs))
  });
  const rawTargets = await response.json();
  const targets = Array.isArray(rawTargets) ? rawTargets.map((target, index) => {
    const classification = classifyRawCdpTarget(target);
    return {
      index,
      id: typeof target?.id === 'string' ? target.id : '',
      type: typeof target?.type === 'string' ? target.type : '',
      title: typeof target?.title === 'string' ? target.title : '',
      url: typeof target?.url === 'string' ? target.url : '',
      attached: Boolean(target?.attached),
      classification,
      webSocketDebuggerUrl: typeof target?.webSocketDebuggerUrl === 'string' ? target.webSocketDebuggerUrl : ''
    };
  }) : [];
  const chatGptTargets = targets.filter(target => target.classification.isChatGpt);
  const chatGptHomeTargets = targets.filter(target => target.classification.isChatGptHome);
  const chatGptConversationTargets = targets.filter(target => target.classification.isChatGptConversation);
  const rawCleanupCandidates = targets.filter(target => target.classification.rawCleanupCandidate);

  return {
    ok: response.ok,
    service: 'network-mcp-browser-worker',
    endpoint,
    status: response.status,
    timeoutMs,
    count: targets.length,
    chatGptInventory: {
      chatGptTargetCount: chatGptTargets.length,
      chatGptHomeTargetCount: chatGptHomeTargets.length,
      chatGptConversationTargetCount: chatGptConversationTargets.length,
      rawCleanupCandidateCount: rawCleanupCandidates.length,
      rawCleanupCandidateIndexes: rawCleanupCandidates.map(target => target.index),
      safety: 'read-only-raw-cdp-inventory; cleanup still requires DOM/draft verification before close'
    },
    targets
  };
}

