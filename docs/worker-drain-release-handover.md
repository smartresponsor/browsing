# Worker drain and sealed release cutover

## Scope

The Browser MCP worker is **not** the owner of the Edge browser. Worker
maintenance must not relaunch Edge, reuse or modify its profile, or restart
Console MCP. The worker executable is loaded exclusively from a verified,
signed release.

## Internal drain protocol

A future worker release supports the following **internal maintenance**
POST endpoints. These are not public Web capabilities and are not exposed
through MCP tools:

- `/worker-drain`: prevent admission of new non-diagnostic operations,
  returning `WORKER_DRAINING` while a previous operation is outstanding and
  `WORKER_DRAINED` only when the local request counter is zero.
- `/worker-drain-status`: inspect current drain and active-operation state.
- `/worker-resume`: lift the drain when a cutover is abandoned.

Each operation requires the normal worker bearer token **and** an independent
`x-browser-worker-drain-token` matching the separately provisioned
`BROWSER_MCP_WORKER_DRAIN_TOKEN`. When the variable is absent or shorter than
32 characters, this administrative interface is disabled. Never print,
persist in source, or reuse this token in user-facing requests.

When a request is interrupted before its completion is confirmed, the
controller may retain its operation count. That is intentionally
fail-closed: no assumption that an externally visible operation finished.

## Cutover gates

1. Validate candidate and rollback as independent signed releases.
2. Confirm exact ownership of worker PID, entrypoint, Windows session,
   token policy, listener port and unrelated Edge PID.
3. Drain at the existing worker's authenticated administrative endpoint
   and receive an exact `WORKER_DRAINED` acknowledgment. Revalidate that
   state immediately before stopping the worker.
4. Switch only the worker via a transactionally controlled launcher pointing
   at the new sealed release. Retain the signed previous-release descriptor.
5. Verify worker identity, health, CDP continuity and a read-only target
   operation; rollback to the signed previous release if verification fails.
6. Do not replay a user operation whose outcome was not conclusively observed.

**Bootstrap limitation:** the incumbent Windows worker PID 16444 predates
this drain interface. Its health endpoint cannot attest quiescence, so
it is not eligible for automated cutover using these gates. Implementing
the protocol in a future release does **not** authorize killing the legacy
worker or bypassing the drain requirement. A separate approved maintenance
handover with an authoritative external operation lease is required for
initial migration.
