# Browser MCP visible-session integration

Browser MCP imports Console's canonical native verifier from `mcp/console-mcp/dist/service/visible-browser-session.js`. Build Console first. Console owns runtime launch and recovery; Browser MCP is attach-only and never manufactures a profile or target identity.

The authenticated middleware protects all automation routes with pre/post native window/session verification. It serializes shared-page operations, refuses stale or ambiguous binding, retains final-submit/receipt gates, and marks diagnostics as visibility-unverified. `/healthz` does not equate HEADLESS=false with visibility. Restart/kill/open-fresh routes require Console orchestration and cannot launch a competing runtime.

The authoritative contract, native evidence requirements, limitations and controlled deployment procedure are in Console's `docs/visible-browser-session-standard.md`. Windows localhost is never inferred from Ubuntu localhost. Run `npm test` and the dedicated `tool/web-visible-session-regression.mjs`; Console must already be built.
