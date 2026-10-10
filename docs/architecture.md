# Architecture

`browser-mcp` is the supervised browser/web capability consumer in the MCP workspace.

Its canonical role is to provide browser/form semantics on top of Console-owned execution infrastructure.

## Ownership boundary

Console MCP owns:

- the ChatGPT-facing MCP connector and tool gateway;
- browser process/runtime lifecycle;
- generic task/run identity;
- async execution lifecycle, cancellation, timeout, capacity, and leases;
- shared DevTools/CDP availability and browser resource hygiene.

Browser MCP owns:

- browser/web domain semantics;
- target identity and page/form revisions;
- semantic form extraction;
- type-specific field mutations and postcondition verification;
- guarded upload semantics;
- review/approval domain receipts;
- human-boundary classification;
- domain-specific navigation and confirmation evidence.

Browser MCP must not introduce a competing generic orchestration engine or generic async run lifecycle.

## Runtime components

The repository still contains three runtime components:

- `playwright-worker/src/worker.js` — local Web browser capability worker on port `8791`;
- `mcp-server/src/server.js` — compatibility/local-validation MCP surface on port `8792`;
- `cloudflare-worker/src/index.ts` — legacy/public gateway and proxy surface.

The local `mcp-server` is not the canonical ChatGPT-facing connector. The canonical ChatGPT-facing registration plane is Console MCP.

## Browser model

The canonical browser runtime is Console-owned.

Web attaches to the shared supervised browser over CDP and must not launch a competing browser in normal Console-owned mode.

Fallback standalone browser behavior may remain only for bounded local development/compatibility testing and must not redefine runtime ownership.

## Supervised domain flow

The Web domain flow is intentionally supervised:

1. inspect/bind an explicit target;
2. capture page/form revisions;
3. extract semantic controls;
4. propose bounded operations;
5. require approval where policy requires it;
6. apply type-specific mutations;
7. verify postconditions;
8. capture review evidence;
9. perform final submit only when explicitly enabled and approved;
10. verify or explicitly report an unverified terminal outcome.

## Architectural guardrails

- Console MCP is the execution/orchestration owner.
- Browser MCP is the capability/domain-state owner.
- Do not create Web-owned generic `runId`, process leases, async start/status/output/stop, or retry/cancel engines.
- Do not launch a second browser when Console-owned CDP runtime is available.
- Bind mutations to explicit target/page/form revisions and fail closed on stale state.
- Keep credentials manual and never log password values.
- Treat CAPTCHA, 2FA, login/security challenges, and unsupported controls as typed human boundaries.
- Keep uploads guarded by a dedicated artifact root, type/size/hash validation, and exact file-control binding.
- Final submit remains disabled by default and approval-gated when enabled.
- Never close unrelated user/Console browser targets.

## Local ports

- `playwright-worker`: `127.0.0.1:8791`
- compatibility `mcp-server`: `127.0.0.1:8792/mcp`
- shared browser/CDP: Console-owned, normally port `9223`

## Auth and transport

- The browser worker must remain local-only or be protected with `BROWSER_MCP_BROWSER_WORKER_TOKEN`.
- Public/tunnel surfaces are compatibility/deployment concerns and must not move browser ownership out of Console.
- Secret values come from runtime secret injection and must not be committed.

## Validation

- `npm run typecheck` validates worker/server syntax.
- `npm run test` validates capability symmetry, revision semantics, semantic form behavior, guarded uploads, registry symmetry, and persistent-runtime compatibility.
- Console `schema:validate` independently verifies the Web/Console ownership contract.
