# ChatGPT Session Availability

## ChatGPT session availability check

A working public MCP endpoint does not guarantee that every ChatGPT conversation has the connector injected. Each conversation must be checked separately.

The public endpoint can be healthy while a specific ChatGPT session still cannot call the MCP connector because the namespace is not available in that session.

Expected first probe in a new ChatGPT conversation:

- describe/metadata tool for this server, if available
- health/status tool for this server, if available

If the namespace is not available, reconnect or select the custom ChatGPT app/connector in that conversation.

Interpretation:

- Public smoke `ok=true` means the tunnel, worker, OAuth metadata, or protected MCP endpoint is reachable.
- Successful describe/health call means the connector is actually callable in the current ChatGPT session.
- If another chat says the connector is not exposed, that does not automatically mean the tunnel, worker, or local server is down. It means that specific conversation does not have the connector injected.

For this MVP, the connector should still be treated as a supervised assistant, not an autonomous submitter.
