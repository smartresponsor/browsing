# network-mcp Agent Rules

This repository is the implementation of the local `network-mcp` connector. Treat it as infrastructure code: keep changes small, reviewable, and policy-driven.

## Patch discipline

- Use `console.apply_patch` only after explicit user approval such as `go`, `apply`, `do it`, or an equivalent direct instruction.
- Always send a real unified diff with `diff --git` headers.
- Do not send non-unified wrapper patch formats to `console.apply_patch`; this connector rejects them.
- Prefer `dryRun=true` first for non-trivial patches. Apply with `dryRun=false` only after the dry run reports `ok=true` and `applicable=true`.
- Every hunk must have a valid unified-diff hunk header with correct old and new line counts.
- Do not guess hunk ranges. Read the target file first when possible, then build the diff from the current content.
- Keep each patch focused. Use `expectedChangedFiles` and list only the files that must change.
- Do not patch generated or policy-forbidden output unless the repository policy explicitly allows it.

## Windows execution checks

- This project runs primarily on Windows and PowerShell.
- Allowed command execution must go through named checks exposed by the connector policy; do not add unrestricted shell execution.
- When adding checks for npm scripts, remember that Windows resolves npm to `npm.cmd`; executor behavior must handle `.cmd` / `.bat` safely.
- After changing TypeScript runtime source, rebuild locally and restart the running connector before expecting the live MCP server to use the new code.

## Validation loop

- After a patch, check `git_diff_stat` or the closest project-local diff-stat check when available.
- For this project, prefer project-local build, typecheck, smoke, doctor, and status checks when policy exposes them.
- If a new allowed check returns `Unknown check name`, restart the connector so it reloads policy.
- If a check fails, report the exact `stdout`, `stderr`, `exit_code`, and `transcript_path` before proposing the next patch.

## Project boundary

- Treat `network-mcp` as its own connector project.
- Do not mix `network-mcp` runtime fixes with `console-mcp` runtime fixes unless the user explicitly asks for a cross-connector change.
