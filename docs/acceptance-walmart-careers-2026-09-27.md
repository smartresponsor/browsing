# Walmart Careers Live Acceptance — 2026-09-27

## Scope

Supervised live acceptance against Walmart Careers using the Console-owned browser runtime and Browser MCP domain capabilities.

No final application submission was performed.

## Runtime path

Observed successful path:

1. Console-owned browser opened `https://careers.walmart.com/us/en`.
2. Walmart redirected to `/us/en/home`.
3. Web bound by exact `targetId`.
4. `web.page.wait`, `web.page.capture`, `web.form.inspect`, and `web.form.extract` succeeded.
5. Existing authenticated account session exposed `Dashboard`, `Applications`, `Profile`, `Saved roles`, and `Sign out`.
6. `Profile` route exposed a guarded resume file control.
7. `Applications` showed `Active 0` and `Draft 0`.
8. Technology -> Software Engineering and Architecture -> filtered results produced 531 open roles.
9. One Senior Manager, Software Engineering role was selected.
10. Review Cart opened.
11. Apply entry opened `/us/en/jobs/apply`.
12. `Apply manually` opened the actual application form.

## Successful semantic coverage

The live manual application form produced 20 semantic controls.

Observed categories:

- generic site search;
- resume upload;
- required source select;
- required dependent source-detail select;
- read-only account email;
- required legal first name;
- optional middle initial;
- required legal last name;
- optional preferred first name;
- optional preferred last name;
- required phone;
- country calling-code select;
- optional SMS application-status consent checkbox;
- language radio group;
- current/former-associate relationship radio group.

Web correctly recognized:

- file input as upload-only;
- native selects and bounded option inventories;
- a large country-code select;
- read-only account-bound email;
- required/optional text fields;
- phone semantics;
- checkbox state;
- grouped radio semantics and exact option inventories.

## Safety behavior confirmed

### Exact target binding

The Walmart page was bound by exact target identity instead of URL/index guessing.

### Revision guards

On a dynamic results page, the DOM changed between capture and click and Web returned:

`WEB_PAGE_REVISION_STALE`

The operation did not proceed until a fresh capture was taken.

### No blind click retry

Several Walmart SPA interactions returned:

`WEB_CLICK_POSTCONDITION_UNVERIFIED`

with:

- `retrySafe:false`;
- `externalActionMayHaveOccurred:true`.

The click was not automatically repeated. A subsequent read-only capture proved whether the transition or selection actually occurred.

### Final-submit boundary

No final application submit was performed.

## Live gap 1 — delayed SPA click settling

Repeated pattern:

1. click executes;
2. immediate after-snapshot shows no URL/page/form revision change;
3. Web reports `WEB_CLICK_POSTCONDITION_UNVERIFIED`;
4. a subsequent capture shortly afterward shows the intended transition completed.

Observed examples:

- Applications -> Search for roles -> `/results`;
- selecting a result card;
- Deselect all;
- filtered role selection;
- Results -> Review Cart;
- Review Cart -> `/jobs/apply`.

### Required implementation direction

Add a bounded post-click settling phase before classifying a click as unverified.

The settling phase should:

- preserve fail-closed behavior;
- never blindly replay the click;
- poll only read-only transition evidence;
- stop when target/URL/pageRevision/formRevision changes;
- use a short bounded deadline;
- return the first verified changed state;
- still return `WEB_CLICK_POSTCONDITION_UNVERIFIED` if no transition evidence appears.

A deterministic regression should simulate delayed revision change after click.

## Live gap 2 — mutation-quiet on continuously animated pages

`web.page.wait(state="mutation-quiet")` timed out on Walmart home while later capture/inspect succeeded.

Likely source: continuously changing decorative/carousel UI.

### Required implementation direction

Do not redefine page readiness globally.

Possible fixture-backed approaches:

- support a scoped mutation root;
- allow ignored selectors/regions for known decorative churn;
- or treat mutation-quiet as an optional evidence mode rather than a universal readiness prerequisite.

Keep DOMContentLoaded/load/selector-based readiness available as bounded alternatives.

## Live gap 3 — dependent select lifecycle

The manual application form exposes:

- required parent field: `How did you hear about us?`;
- required child field: `Source detail`.

The child initially contains only a disabled placeholder.

### Required implementation direction

After parent mutation:

1. wait for bounded dependent-control stabilization;
2. capture a fresh form revision;
3. re-extract child options;
4. select only from newly observed options.

Do not infer child options from previous sessions or another site.

## Knowledge-base implication

The reusable field taxonomy from this acceptance pass is mirrored into the local `Granting` knowledge repository as a cross-domain application-form block.

No personal field values should be stored in reusable acceptance documentation.

## Acceptance verdict

The core architecture is viable on a real authenticated career site.

Confirmed live:

- Console-owned runtime composition;
- exact target binding;
- page/form revisions;
- semantic form extraction;
- native file/select/text/phone/checkbox/radio modeling;
- stale revision protection;
- safe unverified-click behavior;
- application-flow navigation up to the manual form.

Primary next correctness fix:

**bounded delayed-SPA post-click settling before declaring the click postcondition unverified.**

