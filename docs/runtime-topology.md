# Browser MCP runtime topology

Browser MCP is a consumer connector stack. Generic MCP hosting and local process supervision are candidates for a future neutral runtime.

## Runtime layers

### Edge gateway

The edge gateway owns the public entry path and deployment edge for Browser MCP.

It should preserve public origin names, upstream references, and OIDC configuration names during cleanup.

### Local MCP server

The local MCP server is a temporary host until a neutral MCP runtime exists.

It currently owns local listen behavior, MCP transport setup, endpoint dispatch, and attachment of the Network tool bundle.

Future cleanup should move generic host behavior out while keeping `network.*` tools in Browser MCP.

### Browser worker

The browser worker is durable Browser MCP behavior.

It owns visible browser execution, worker routes, browser profile behavior, approval gates, host policy, and submit controls.

## Cleanup rule

Remove duplicated generic hosting only after the Network-owned connector surface remains runnable and deployment references are preserved.
