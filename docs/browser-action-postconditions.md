# Browser action postconditions

Console forwards these actions to the canonical Browsing worker. Each handler
invokes its click once. Settling observes only; no uncertain result authorizes
automatic replay, even when navigation failed after the click.

## Explicit submit confirmation

An optional additive contract is accepted by web.form.submit and its Console alias:

```json
{
  "expectedOutcome": {
    "url": "https://cerebralvalley.ai/e/meta-ai-developer-hackathon",
    "element": {
      "selector": "[data-testid='registered-state']",
      "text": "Waitlisted"
    }
  }
}
```

Choose this from the intended application's semantics before execution. URL and
element predicates are conjunctive. Exactly one visible element must have the
expected normalized text. The element/text must not already match before the
action. URL alone, a generic badge, page mutation, hidden text and ambiguous
selectors cannot establish success. An explicit contract takes precedence over
the legacy confirmation-text heuristics; validation rejection takes precedence
over either success mechanism. Existing callers may omit expectedOutcome.

## Classification and identity

- success: observed confirmation, or a non-final click's URL/control-state transition;
- rejected: new validation rejection observed through the end of settling;
- unresolved: attempted action with insufficient, unavailable or inconsistent evidence;
- not_executed: pre-action failure; no click attempted.

Every attempted action has retrySafe=false and externalActionMayHaveOccurred=true.
A click that throws may already have dispatched; it remains unresolved.
A failure before any click may be safely re-inspected; automatic retry is still disabled.
Ownership/admission/approval checks remain required.

Only real CDP target identities and a stable attached browser-context identity
can verify an action. Fallback IDs are usable for read-only diagnosis, never
mutation verification. A changed target or session stops verification immediately.
The outer native-session guard also clears verified on a failed post-action probe.

Submit settling is bounded by 12 observations and a 12-second observation budget
(with internal hard clamps). Click settling defaults to 1.5 seconds and clamps to
3 seconds. Capture failures never authorize a second click. ARIA checked, pressed,
selected and expanded state are observed on the selected control; semantic form
fingerprints also include ARIA state. A generic revision change is diagnostic only.

## Evidence and validation

Action artifacts use the existing var/browser review-artifact directory and private
file permissions. Returned evidenceArtifact identifies structured pre/post identity,
revisions, navigation, selected state, attempts, elapsed time, criteria and outcome.
Form field values are excluded. Persistence errors are reported separately from
the already-observed action outcome.

Run npm test and npm run test:action-postconditions. The latter runs controlled
local Chromium registration fixtures and checks exactly one POST, delayed rendering,
rejection, navigation without confirmation, ARIA state/no-op and target loss.
No real registration is needed.

Deployment is separate from merging. Rebuild Console and restart the managed
browser worker through the existing lifecycle boundary to expose the new schemas
and runtime. No live browser session is restarted by the regression suite.
