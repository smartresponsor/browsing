# Career Apply Architecture

Use this as a bounded context inside `network-mcp`, not as a LinkedIn scraper.

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

- `career.open`
- `career.inspect`
- `career.extract_form`
- `career.propose`
- `career.fill_after_approval`
- `career.review_before_submit`

Final submit is intentionally not implemented in this layer.
