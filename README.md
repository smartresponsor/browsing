# browser-mcp

`browser-mcp` is the supervised browser/network capability consumer in the canonical MCP workspace.

It provides browser/form domain semantics while Console MCP remains the ChatGPT-facing connector and generic execution/runtime owner.

## Canonical role

Browser MCP owns:

- target/page/form inspection;
- semantic form extraction;
- verified field mutations;
- guarded artifact upload;
- review and submit domain policy;
- human-boundary detection;
- browser-domain evidence and statuses.

Console MCP owns:

- browser runtime/process lifecycle;
- ChatGPT-facing tool gateway;
- generic task/run identity;
- async execution, leases, capacity, retry, timeout, and cancellation.

The local `mcp-server` remains a compatibility/local-validation surface. It is not the canonical ChatGPT-facing connector.

## Current supervised flow

1. Console binds or opens the browser target.
2. Network captures exact target/page/form identity.
3. Network extracts semantic controls.
4. Values/actions are proposed.
5. Approval-gated mutations are applied.
6. Network verifies each supported postcondition.
7. Files are uploaded only through guarded artifact references.
8. A review artifact is captured.
9. Final submit remains disabled by default and requires explicit approval when enabled.
10. Network returns verified or explicitly unverified terminal evidence.

## Safety defaults

- Network must not launch a competing browser in Console-owned mode.
- Credentials remain manual.
- CAPTCHA, 2FA, login/security challenges pause automation as human boundaries.
- Form mutations use target/page/form revision guards.
- Password fields are not writable.
- Uploads accept only guarded relative artifact references inside the dedicated upload root.
- Form values and credential material are not logged by default.
- Unrelated browser tabs/processes must not be closed.

## Policy defaults

```env
BROWSER_MCP_MODE=local-assist
BROWSER_MCP_REQUIRE_APPROVAL_FOR_FILL=true
BROWSER_MCP_REQUIRE_APPROVAL_FOR_UPLOAD=true
BROWSER_MCP_REQUIRE_APPROVAL_FOR_SUBMIT=true
BROWSER_MCP_ENABLE_SUBMIT=false
BROWSER_MCP_UPLOAD_ROOT=var\artifacts\uploads
BROWSER_MCP_MAX_UPLOAD_BYTES=26214400
BROWSER_MCP_WORKER_PORT=8791
BROWSER_MCP_BROWSER_CHANNEL=msedge
BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER=true
```

## Capability contract

The machine-readable source of truth is:

`mcp-server/src/capability-contract.js`

It defines Console/Network ownership, risk classes, approvals, binding, replay policy, timeout class, artifact behavior, postconditions, visibility, and compatibility aliases.

## Local validation

Windows:

```powershell
cd D:\PhpstormProjects\www\mcp\browser-mcp
npm run typecheck
npm run test
```

Ubuntu/Linux after a normal clone:

```bash
npm ci
npm --prefix mcp-server ci
npm --prefix playwright-worker ci
npm --prefix playwright-worker run install:browsers
npm run typecheck
npm run test
```

For the canonical supervised runtime, point `BROWSER_MCP_REMOTE_DEBUGGING_PORT` at the Console-owned CDP endpoint (normally `9223`) and keep `BROWSER_MCP_EXTERNAL_VISIBLE_BROWSER=true`. The CDP attach path is supported on Windows and Linux. Windows-only `dev:*` supervisor scripts remain compatibility/operations helpers rather than a runtime requirement.

Operational lifecycle commands remain available for compatibility/local validation, but normal browser ownership belongs to Console MCP.

## Documentation

- [Architecture](docs/architecture.md)
- [Network/Console parity milestone](docs/milestone-browser-mcp-console-parity.md)
- [Operations](docs/operations.md)
- [Security](docs/security.md)
- [Restore on Windows](docs/restore-windows.md)
