# MVP Assisted Application

This document defines the safe MVP for ChatGPT-driven opportunity assistance in `network-mcp`.

## Product intent

`network-mcp` is not a crawler and not a mass-apply system. It is a controlled browser assistant that helps a user work from one opportunity URL toward a selected form.

The user stays in ChatGPT UI and drives the flow.

## MVP flow

1. User gives one URL in ChatGPT.
2. `network-mcp` opens it through the local visible Playwright/browser worker.
3. The worker discovers likely career, jobs, or apply links only within a limited scope.
4. ChatGPT presents options to the user.
5. User selects a page or form.
6. Worker opens the page or form visibly.
7. Worker inspects fields and returns a field map.
8. ChatGPT proposes values.
9. User approves.
10. Worker fills approved fields only.
11. Submit is disabled by default; user submits manually unless explicit submit mode is enabled later.

## Safe defaults

```env
NETWORK_MCP_MODE=local-assist
NETWORK_MCP_HEADLESS=false
NETWORK_MCP_REQUIRE_APPROVAL_FOR_FILL=true
NETWORK_MCP_REQUIRE_APPROVAL_FOR_SUBMIT=true
NETWORK_MCP_SUBMIT_DEFAULT=false
NETWORK_MCP_ENABLE_SUBMIT=false
NETWORK_MCP_MAX_SESSION_SECONDS=900
NETWORK_MCP_MAX_PAGE_VISITS=20
NETWORK_MCP_MAX_FORM_FILLS=1
NETWORK_MCP_MAX_FIELD_WRITES=80
NETWORK_MCP_ALLOWED_HOSTS=
NETWORK_MCP_DENIED_HOSTS=
NETWORK_MCP_PUBLIC_ORIGIN=
NETWORK_MCP_WORKER_PORT=8791
```

## Guardrails

- Reject or pause on denied hosts.
- Allow only one active browser session by default.
- Enforce max session seconds.
- Enforce max page visits.
- Enforce max form fills.
- Enforce max field writes.
- Require approval for fill actions.
- Require separate approval for submit actions.
- Disable submit unless `NETWORK_MCP_ENABLE_SUBMIT=true`.

## Browser safety policy

- Browser is visible by default.
- Login and registration must be user-driven.
- CAPTCHA, 2FA, and security challenge pages pause automation.
- Credentials must be entered manually by the user.
- Form values are not logged by default.
- Screenshots, traces, videos, and downloads stay under ignored runtime directories such as `var\browser\`.
- Browser storage state and cookies are not committed.

## Tool/API contract

The current internal command prefix is `career_`.

That prefix is legacy/internal and will later migrate to `network_*`.

Documented safe operations:

- `network.open_url`
- `network.discover_opportunity_links`
- `network.open_opportunity`
- `network.inspect_form`
- `network.fill_approved_fields`
- `network.save_draft` if supported later
- `network.submit_form` only if explicit submit mode is enabled

## Cloudflare Worker cost control

The Cloudflare Worker must remain a thin gateway.

Allowed:

- auth
- routing
- status/smoke
- small request validation
- rate/limit guard

Not allowed for the MVP:

- crawling
- long browser jobs
- AI calls
- mass retries
- storage-heavy workflows
- automatic apply jobs

## Notes

- Do not store credentials.
- Do not store cookies or browser state in Git.
- Do not run headless by default.
- Do not submit applications by default.
