# Application scenario consolidation — 2026-10-19

## Baseline and preservation

- Browser MCP `master` includes merged PR #4 (`2e438c4`), with the independently signed consolidation and upstream canonical `web.*` changes.
- Four one-shot Git merge scripts and two cleanup scripts were preserved under ignored `var/preservation/integration-pr4-20261019/` with SHA-256 records. No job-application script was deleted.
- The 2026-10-19 initial read-only sample classified 526 untracked PS1/MJS scenario files. Results are heuristic and include non-job helper scripts; rerun `tool/audit-application-scenarios.ps1` for a fresh snapshot.
- Highest-frequency filename families in that sample: databank (68), meta (63), google (56), myriad (42), walmart (41), insight (32), amazon (29), akkodis (28), sterling (28).
- Rough lexical signals: DOM inspection 262 files, form input 70, upload 28, final submit 30. Counts overlap and are *not* evidence of successful calls or production readiness.

## Architectural disposition

Site-specific scripts are evidence and temporary diagnostics, **not** new MCP commands. The reusable contract is implemented in `playwright-worker/src/worker.js`, the canonical `web.*` tool bundle and guarded regression tests.

Promote capabilities only if a reviewed scenario demonstrates a repeatable behavior absent from the existing worker, for example:

1. **Form widgets:** controlled Workday date segments, autocomplete option disambiguation and stable post-blur verification.
2. **Upload:** hidden file input and dropzone interaction through the guarded artifact contract; verify that the server actually accepted the attachment.
3. **Submission:** user-approved final submit, asynchronous postcondition polling, receipt/confirmation evidence and duplicate prevention when outcome is unknown.
4. **Session recovery:** worker/CDP attach timeouts, exact target binding, preservation of external Edge profile and avoidance of unsafe automatic browser restarts.
5. **Application evidence:** structured capture of opening job URL, final confirmation and status, with personal data excluded from source-control fixtures.

## Upload capability implementation (2026-10-19)

Existing `web.form.upload` now supports three supervised paths without introducing another MCP command:

- An explicit semantic `controlId`, including hidden native file input within an iframe or open shadow root.
- An omitted `controlId`/`selector` only when exactly one enabled semantic file input exists.
- An explicit `selector` for exactly one visible and semantically recognizable upload/dropzone trigger; this uses Playwright `FileChooser` only after the existing upload approval and artifact checks. Submit/reset buttons, links, ambiguous selectors and generic navigation controls are refused.

All paths require a relative artifact reference under the dedicated upload root and preserve expected target/page/form revision checks. File selection occurs once; when the UI detaches a native input or CDP loses the reply, the state becomes uncertain and automatic retries are forbidden.

A `WEB_UPLOAD_VERIFIED` response means the selected file's name and size matched `input.files` locally, with `uploadStage=input-file-selected`, `selectionVerified=true`, and **`serverAcceptanceVerified=false`**. Applications must inspect employer-side attachment indicators or confirmation steps separately; no claim of completed server upload is made from local selection alone.

Tests: `npm test` and `npm run typecheck`. Optional isolated real-Edge smoke: `tool/test-upload-browser.ps1`, covering hidden input, iframe file input and dynamic dropzone `FileChooser`; it does not connect to the visible/shared Edge instance.

## Promotion gate

A capability is eligible for a separate signed commit only after confirming:

- It is applicable beyond one employer and does not duplicate an existing `web.*` operation.
- It obeys the visible-session and exact-target guards, approval requirements, and no-duplicate-submit rule.
- Regression tests cover positive, failure, stale-target, ambiguous-window and unknown-outcome paths as relevant.
- `npm test` and `npm run typecheck` pass; documentation and tool contract are updated together.
- No personal CV, token, cookie, candidate answer, browser storage or employer-specific submit script is accidentally committed.

Do not stage the untracked scenario directories wholesale. Retain them as forensic evidence until explicitly reviewed and independently archived.

