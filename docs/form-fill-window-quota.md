# Form-fill rate policy (Browsing worker)

A prior implementation kept `formFillCount` and `fieldWriteCount` as process-lifetime gates,
with defaults 20/80. Long-lived attach-only Edge workers could exhaust those values even
if no form was filled today. This was **not** a parallel-task cap.

The form-fill admission now uses a sliding window (default 60 seconds), independent
of worker lifetime or external browser uptime. Default limits within that window:

- `BROWSER_MCP_MAX_FORM_FILLS=20`: completed/possibly-partial form fills per window
- `BROWSER_MCP_MAX_FIELD_WRITES=80`: cumulative field writes per window
- `BROWSER_MCP_MAX_FIELDS_PER_OPERATION=20`: per-request field bound
- `BROWSER_MCP_FILL_RATE_WINDOW_SECONDS=60`: rolling window duration

The old cumulative counters remain in diagnostic `runtime.session` only; the
new `runtime.session.fillRate` reports window usage and reservations. A rejected
fill emits `WEB_RATE_LIMITED` with `kind,used,limit,windowSeconds,retryAfterMs,
retryAfterSeconds,requestedWrites`, plus `mutation_attempted=false` and
`automatic_retry_allowed=false`. A too-large field set emits
`WEB_OPERATION_SIZE_LIMIT`. No quota refusal initiates browser restart.

The counter reserves capacity before any browser mutation, releases it if no write
started, and charges it if a write may have partially happened. Approval receipts,
secret handling, target/revision checks and separate final-submit approval are unchanged.
Do not automatically replay a rejected fill. After a cooling window, rebind the
exact target, recapture form, and obtain fresh approval.

The limiter is worker-local in-memory, so separate workers are independent. If a
shared distributed quota is later needed, the admission backend must coordinate
reservations instead of inferring counts from worker uptime.

Deployment: source-only. This change does not change a running worker, its
environment variables, active Edge profile, CDP endpoints or release selection.
