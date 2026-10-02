# Browser MCP dev supervisor boundary

`tool/dev-browser.ps1` is still the active local supervisor. Keep it runnable until a green split path exists.

## Reusable candidates

These mechanics can later move to a neutral supervisor library:

- directory creation for run and log paths;
- PID file helpers;
- process tree stop helpers;
- TCP listener checks;
- command discovery;
- generic start, stop, restart, status, and log tail shapes;
- scheduled task wrapper shape;
- JSON status serialization.

## Network-owned behavior

These parts should remain Browser MCP behavior:

- Playwright worker lifecycle;
- visible browser defaults;
- browser profile behavior;
- local MCP server wiring until the neutral runtime exists;
- Network tunnel naming conventions;
- Network smoke checks;
- worker route probes;
- `BROWSER_MCP_*` configuration names.

## Safe split order

1. Add dot-sourced files under `tool/dev-network.d/`.
2. Move pure helpers first.
3. Move state readers next.
4. Move process lifecycle functions next.
5. Move smoke functions last.
6. Run status and smoke checks.
7. Commit the split before any behavior changes.

The cleanup goal is structural separation, not reconfiguration.
