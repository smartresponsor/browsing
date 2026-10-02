# Career Apply Architecture

Use this as a bounded context inside `browser-mcp`, not as a LinkedIn scraper.

## Safe operating model

- Human opens/approves the target opportunity.
- Browser worker inspects visible form fields.
- AI proposes values.
- User approves a field map.
- Worker fills approved values.
- Worker pauses before final submit.
- User explicitly confirms final submit.

## Non-goals

- No captcha bypass.
- No stealth automation.
- No cookie extraction.
- No unattended mass apply.
- No ToS evasion.

## Supervised tools

- `network.open`
- `network.inspect`
- `network.extract_form`
- `network.propose`
- `network.fill_after_approval`
- `network.review_before_submit`

Final submit is intentionally not implemented in this layer.
