# Milestone: Network MCP maturity uplift and Console MCP parity

Status: active  
Repository: `D:\PhpstormProjects\www\mcp\network-mcp`  
Baseline date: 2026-09-26

## Goal

Raise Network MCP from a supervised browser/form MVP into a durable, inspectable, recoverable browser capability platform that can reliably execute long-lived real-world form workflows while remaining subordinate to the Console-owned browser runtime.

The target is not literal tool-count parity with Console MCP. The target is parity in engineering discipline:

- explicit ownership and capability boundaries;
- durable identities instead of implicit global mutable state;
- deterministic lifecycle/status contracts;
- bounded and resumable execution;
- fail-closed mutation and submit policy;
- verification after each meaningful mutation;
- inspectable artifacts and diagnostics;
- capability discovery instead of undocumented heuristics;
- recovery without restarting unrelated browser/user state;
- regression coverage for the failure modes that matter in production.

## Current verified baseline

### Runtime boundary

The live Console bridge reports:

- browser runtime owner: `console-mcp`;
- Network capability owner: `network-mcp`;
- browser launch by Network: disabled at the bridge boundary;
- Network uses Console-owned DevTools ports;
- active DevTools port: 9223;
- Network capability contract source:
  `D:\PhpstormProjects\www\mcp\network-mcp\mcp-server\src\capability-contract.js`.

This is the correct long-term ownership direction and should be preserved.

### Current capability surface

The current Network capability contract exposes 27 tools: 15 read and 12 write.

Important product capabilities already exist:

- browser status / target inventory / target bind;
- open / open job / open fresh;
- page capture;
- readiness waiting;
- inspect / extract form;
- propose;
- approval-gated fill;
- review-before-submit with review hash;
- approval-gated submit;
- shared-browser/CDP cleanup utilities.

### Current validation baseline

- root `npm run typecheck`: green;
- root `npm audit --audit-level=moderate`: zero reported vulnerabilities.

### Canonical-repository convergence

The canonical MCP workspace is `D:\PhpstormProjects\www\mcp`, and the authoritative Network repository is `D:\PhpstormProjects\www\mcp\network-mcp`.

A legacy mirror remained at `D:\PhpstormProjects\www\network-mcp` and accumulated unique browser/CDP work after the original mirror-first migration. That history has now been merged back into the canonical repository. The legacy root copy is evacuation-only and must not receive further development.

## Major gaps relative to Console MCP maturity

### 1. Durable execution identity is missing

Console MCP has durable task/run identities, lifecycle status, bounded execution, checkpointed progress, leases, and recovery semantics.

Network MCP still relies heavily on process-global mutable state such as:

- current `page`;
- browser/context handle;
- session start timestamp;
- page/fill/write counters;
- mutable active target binding.

Consequences:

- a restart loses workflow identity;
- concurrent callers can interfere through one active page;
- retries cannot distinguish replay from a new action;
- a tool result cannot reliably prove which exact target/form revision was mutated.

### 2. Capability contract is too shallow

The current contract is schema version 1 and primarily records:

- name;
- route;
- read/write risk;
- explicit-approval flag;
- a legacy-surface flag.

It does not yet encode:

- argument schema identity;
- result schema identity;
- idempotency/replay policy;
- required browser binding;
- target mutation class;
- approval scope;
- timeout class;
- artifact production;
- resumability;
- postcondition verification;
- destructive/final-action semantics;
- sensitive-data handling class;
- supported document/frame/control semantics;
- deprecation/replacement metadata.

### 3. Error/status taxonomy is inconsistent

Worker routes frequently return ad-hoc HTTP 409 plus free-form `error` strings.

Console MCP increasingly returns stable machine-readable statuses and explicit policy evidence.

Network needs canonical status families such as:

- `NETWORK_TARGET_NOT_BOUND`;
- `NETWORK_TARGET_STALE`;
- `NETWORK_FORM_REVISION_STALE`;
- `NETWORK_FIELD_NOT_FOUND`;
- `NETWORK_FIELD_AMBIGUOUS`;
- `NETWORK_CONTROL_UNSUPPORTED`;
- `NETWORK_VALIDATION_FAILED`;
- `NETWORK_CHALLENGE_DETECTED`;
- `NETWORK_APPROVAL_REQUIRED`;
- `NETWORK_APPROVAL_STALE`;
- `NETWORK_NAVIGATION_CHANGED`;
- `NETWORK_UPLOAD_REQUIRED`;
- `NETWORK_HUMAN_ACTION_REQUIRED`;
- `NETWORK_SUBMIT_POSTCONDITION_UNVERIFIED`.

Every mutation should return a stable status, target identity, before/after evidence, and recommended next action.

### 4. Form model is DOM-element-centric, not semantic

Current extraction begins from:

`input, textarea, select`

Current write behavior is essentially:

- `selectOption` for native `select`;
- `fill` for other accepted controls.

That misses common production controls:

- custom ARIA combobox/listbox widgets;
- autocomplete/typeahead controls;
- native and custom checkbox/radio groups as semantic choices;
- switch/toggle controls;
- contenteditable rich-text editors;
- date/month/time widgets;
- phone/country compound inputs;
- address-autocomplete components;
- multi-select/tag controls;
- drag/drop or file-upload widgets;
- dynamic repeatable sections;
- React/Vue controlled inputs whose state is not equivalent to DOM value;
- controls nested inside iframes;
- open shadow roots;
- validation state rendered outside the input element.

The field model must become a semantic control graph, not a flat index array.

### 5. Index-based field identity is fragile

A mutation may address a field using an index from the last snapshot.

Dynamic forms routinely insert/remove/reorder nodes. Therefore an index can become stale between inspect and fill.

Introduce durable field identity derived from a form revision plus stable semantic anchors, for example:

- frame identity;
- form/container identity;
- normalized label/question text;
- role/control type;
- name/id/test-id where present;
- DOM ancestry fingerprint;
- option-set fingerprint.

Mutations must reject stale identities instead of writing to the field currently occupying an old index.

### 6. Form revision / optimistic concurrency is incomplete

A page capture produces hashes, and submit can optionally validate a review hash. This needs to become a general optimistic-concurrency model.

Every mutating action should optionally/usually require:

- `targetId`;
- `pageRevision`;
- `formRevision`;
- exact field/control identity;
- expected current value/state.

If the page or control changed, fail closed and require reinspection.

### 7. Multi-step workflows are not first-class

Real application forms are state machines:

1. page/form discovery;
2. identity/contact;
3. resume/upload;
4. experience/history;
5. eligibility/legal;
6. EEO/self-ID;
7. custom questions;
8. review;
9. submit;
10. confirmation.

Network currently exposes atomic browser actions but no durable workflow state.

Add a workflow/session record that persists:

- workflow ID;
- target binding;
- current step;
- completed steps;
- form revisions;
- pending human boundary;
- approvals consumed;
- uploaded artifact references;
- latest validation errors;
- latest review artifact;
- terminal status.

### 8. No Network equivalent of durable async command lifecycle

Some browser operations can legitimately exceed a normal synchronous MCP request:

- waiting for dynamic navigation;
- large file upload;
- complex SPA state transitions;
- long login/manual-human boundaries;
- post-submit confirmation polling.

Introduce durable run primitives analogous to Console MCP:

- start;
- status;
- incremental output/events;
- stop/cancel;
- timeout;
- lease ownership.

Do not force every complex browser action into one synchronous HTTP request.

### 9. Human-boundary handling is only exception-based

CAPTCHA/2FA/challenge detection currently throws an error.

Instead materialize a typed human boundary:

- boundary type;
- exact target;
- reason/evidence;
- requested user action;
- safe resume token/condition;
- expiry/staleness behavior.

The workflow should become `waiting_human`, not simply failed.

### 10. Authentication/session ownership needs stronger formalization

Login is intentionally user-driven and credentials should remain manual. Preserve that.

Add explicit session-state capabilities:

- authenticated/unauthenticated/unknown;
- current account hints where safe;
- login redirect detected;
- session expired;
- cross-origin auth hop in progress;
- user action required.

Never log credentials or expose password field contents.

### 11. File upload is a critical missing capability

Current field safety explicitly rejects `input[type=file]`.

That blocks many application/grant/legal/admin workflows.

Add a guarded upload capability with:

- explicit local artifact reference;
- MIME/extension/size checks;
- allowed root policy;
- no arbitrary filesystem path traversal;
- exact target control identity;
- optional hash of expected file;
- post-upload verification using visible filename/state;
- no content logging by default.

This should be a separate write capability, not overloaded into generic fill.

### 12. Download/artifact handling is under-specified

Network should support controlled downloads and generated browser artifacts with:

- deterministic artifact IDs;
- filename sanitization;
- size and MIME;
- source URL;
- creation timestamp;
- local ignored runtime path;
- retention policy;
- optional checksum;
- explicit user-facing materialization/export step.

### 13. Frame and shadow-DOM traversal need first-class support

Form inspection should inventory:

- top frame;
- child iframes;
- same-origin vs cross-origin boundaries;
- open shadow roots;
- inaccessible frame/control reasons.

Field identity must include frame/shadow path.

### 14. Navigation and pop-up semantics need stronger binding

Clicks can cause:

- same-tab navigation;
- SPA mutation;
- new tab/window;
- OAuth popup;
- download;
- modal/dialog.

Mutations should report which transition occurred and update workflow binding deterministically.

Do not silently continue on whichever global page variable happens to be active.

### 15. Mutation verification is too weak

Console MCP verifies repository mutations with postconditions/gates.

Network needs equivalent browser postconditions.

Examples:

- text fill: reread value and validation state;
- checkbox/radio: verify checked state;
- select/combobox: verify selected semantic option;
- upload: verify file badge/name;
- navigation: verify URL/title/expected landmark;
- submit: verify confirmation page, success message, record ID, or explicit unverified status.

A successful Playwright method call is not sufficient proof of product success.

### 16. Approval should bind to exact proposed mutation

Current fill approval is essentially `approved=true` plus `approvalText=APPLY`.

Strengthen approval receipts so they bind to:

- workflow ID;
- target ID;
- form revision;
- exact operations;
- normalized values or protected value hashes where appropriate;
- approval timestamp;
- one-time consumption status.

Submit approval should bind to the exact review artifact/revision and be invalidated by intervening mutation.

### 17. Risk taxonomy needs more than read/write

Recommended classes:

- read-only observation;
- navigation;
- reversible UI mutation;
- data-entry mutation;
- local artifact upload;
- account/session mutation;
- destructive action;
- final external submit;
- security-sensitive/human boundary.

Policy can then be enforced consistently at contract level.

### 18. Observability is not workflow-grade

Add structured event envelopes for every action:

- timestamp;
- workflow/run/tool IDs;
- target/page/form revisions;
- elapsed time;
- status;
- retry count;
- transition type;
- redacted error class;
- produced artifacts.

Never record raw sensitive form values by default.

Add bounded ring-buffer/event retrieval so failures can be diagnosed without scraping console logs.

### 19. Regression suite is too narrow

Current root `test` focuses on browser CDP cleanup confirmation.

Build a hermetic fixture suite covering semantic browser behavior without external sites.

Required fixture families:

- native inputs;
- checkbox/radio groups;
- native select;
- custom combobox/listbox;
- autocomplete;
- dynamic conditional fields;
- multi-step wizard;
- validation errors;
- iframe form;
- shadow-root form;
- file upload;
- popup/new-tab navigation;
- SPA route change;
- challenge/human-boundary page;
- stale-form mutation rejection;
- review-hash invalidation;
- submit success/unverified/failure states.

### 20. Capability/implementation symmetry is not gated

Add a canon-style symmetry gate for Network:

- capability contract tool exists;
- MCP schema exists;
- worker route exists;
- risk/approval metadata matches;
- no undocumented worker mutation route;
- deprecated/legacy routes are explicit;
- Console bridge exposure matches the authoritative Network contract.

This is directly analogous to the API/OpenAPI/runtime symmetry direction used elsewhere in the platform.

### 21. Documentation is stale relative to implementation

Current docs still say variants of:

- final submit is not implemented;
- old tool names such as `network.inspect_form` / `network.submit_form`;
- default browser ownership assumptions that no longer fully describe Console-owned runtime.

Docs must be regenerated/reconciled from the capability contract and current ownership model.

### 22. Legacy root repository evacuation

Repository authority is explicit:

- canonical: `D:\PhpstormProjects\www\mcp\network-mcp`;
- legacy evacuation source: `D:\PhpstormProjects\www\network-mcp`.

Required completion work:

- keep all future Network development in the canonical repository;
- update Console bridge/runtime references to the canonical capability-contract path;
- mark the root copy as legacy/evacuated;
- remove it from active workspace use after runtime validation;
- add a guard against accidentally operating on the retired copy.

## Delivery plan

### Phase 0 — Complete canonical convergence and evacuation

Priority: P0

- Keep `D:\PhpstormProjects\www\mcp\network-mcp` as the only authoritative Network repository.
- Preserve the already-merged unique history from the former root mirror.
- Update Console bridge/runtime path references from the root mirror to the canonical repository.
- Mark `D:\PhpstormProjects\www\network-mcp` as legacy/evacuated and stop all development there.
- Update architecture docs to state:
  - Console owns browser runtime;
  - Network owns browser semantics/capabilities;
  - standalone Network connector is not required for ChatGPT-facing use.
- Capture the converged capability snapshot and test baseline.

Exit criteria:

- only one authoritative Network repository;
- bridge and docs agree on the canonical `mcp/network-mcp` path;
- root mirror is no longer used by runtime or development;
- no unique code is lost.

### Phase 1 — Capability Contract v2

Priority: P0

Implementation status: first synergy slice complete. Contract schema v2 now carries ownership, risk class, approval policy, binding, replay, timeout, artifact, visibility, schema identity, and postcondition metadata. Default tests enforce contract ↔ worker route ↔ MCP registration symmetry, and Console MCP consumes the v2 policy surface with explicit READY/DEGRADED synergy status.

Create a typed machine-readable Network capability contract containing:

- stable tool ID/name;
- semantic version;
- route;
- input/output schema IDs;
- risk class;
- approval policy;
- idempotency/replay class;
- required binding/workflow state;
- timeout class;
- artifact behavior;
- mutation postcondition;
- deprecation metadata.

Generate/validate MCP registration from this contract instead of hand-maintaining parallel schema definitions.

Exit criteria:

- contract ↔ MCP schema ↔ worker route symmetry test is green;
- legacy aliases are explicit and removable.

### Phase 2 — Durable target/workflow identity

Priority: P0

Implementation status: target/revision foundation started. Page/review captures now produce durable CDP `targetId`, `pageRevision`, and `formRevision`; approved fill and submit accept expected revisions and reject stale target/page/form state with stable Network statuses. Workflow/run persistence and leases remain pending.

Add durable records for:

- `workflowId`;
- `targetId`;
- `runId`;
- page revision;
- form revision;
- active step/status.

Use atomic persistence under ignored runtime state.

Add exclusive mutation lease per workflow/target.

Exit criteria:

- worker restart can recover inspectable workflow state;
- two callers cannot mutate the same workflow concurrently;
- stale target IDs fail closed.

### Phase 3 — Semantic Form Model v2

Priority: P0

Replace flat field snapshots with semantic controls.

Control types should include at minimum:

- text;
- textarea;
- email;
- phone;
- number;
- native select;
- checkbox;
- radio group;
- switch;
- combobox;
- autocomplete;
- multi-select;
- date/time;
- contenteditable;
- file upload;
- unsupported/human-required.

Each control exposes:

- stable semantic identity;
- label/question/context;
- frame path;
- required/visible/enabled/read-only;
- current semantic value/state;
- options where bounded;
- validation state;
- supported mutation operations;
- blocked reason.

Exit criteria:

- fixture forms produce stable semantic snapshots independent of DOM index.

### Phase 4 — Mutation primitives and verification

Priority: P0

Create type-specific mutations:

- set text;
- select option;
- toggle;
- choose radio;
- choose combobox/autocomplete option;
- set date;
- upload file;
- clear field;
- click non-final transition.

Every mutation:

1. validates target/form revision;
2. validates exact control identity;
3. executes one bounded action;
4. waits for relevant UI stabilization;
5. verifies semantic postcondition;
6. returns before/after evidence.

Exit criteria:

- no generic mutation reports success without postcondition verification.

### Phase 5 — Multi-step workflow engine

Priority: P1

Add deterministic workflow transitions:

- inspect;
- propose;
- approve;
- apply;
- validate;
- advance;
- human boundary;
- review;
- submit;
- verify confirmation;
- complete/failed/cancelled.

Persist step history and pending actions.

Exit criteria:

- a multi-page fixture can be interrupted/restarted and resumed without guessing current state.

### Phase 6 — Approval receipts v2

Priority: P1

Replace bare approval strings as the primary trust primitive.

Keep human-readable `APPLY` / `SUBMIT` if useful, but bind them to a server-produced receipt containing:

- workflow;
- target;
- revisions;
- operations;
- review hash;
- expiry;
- one-time consumption.

Exit criteria:

- approval becomes invalid after any material form change;
- replay is rejected.

### Phase 7 — Human-boundary protocol

Priority: P1

Model CAPTCHA, 2FA, login, consent, unexpected modal, unsupported control, and security challenges as explicit resumable states.

Exit criteria:

- workflows pause with a typed action request;
- resume requires revalidation of target/session state.

### Phase 8 — File/artifact subsystem

Priority: P1

Implement guarded:

- upload;
- download;
- screenshot;
- review artifact;
- optional trace/HAR for diagnostics when explicitly enabled.

Add artifact metadata, retention, checksums, and redaction rules.

Exit criteria:

- resume/CV/document upload works through a safe artifact reference;
- no arbitrary host filesystem path is accepted from the model.

### Phase 9 — Async run lifecycle

Priority: P1

Introduce Network equivalents of:

- start;
- status;
- event/output read;
- cancel/stop;
- timeout;
- durable completion/failure state.

Use this for long waits, downloads/uploads, complex transitions, and submit verification.

Exit criteria:

- long browser actions do not depend on a single MCP request staying alive.

### Phase 10 — Structured observability

Priority: P1

Add:

- stable status codes;
- action timeline;
- per-step duration;
- retry counters;
- current workflow snapshot;
- redacted diagnostic events;
- bounded event retrieval;
- runtime health summary.

Exit criteria:

- a failed application can be diagnosed from Network MCP evidence without opening raw runtime logs.

### Phase 11 — Real-world adapter heuristics without hard-coding product logic

Priority: P2

Keep a generic semantic core, but add bounded adapters/recognizers for common application platforms:

- Greenhouse;
- Lever;
- Ashby;
- Workday;
- iCIMS;
- SmartRecruiters;
- Taleo/Oracle;
- Salesforce career flows;
- NEOGOV/GovernmentJobs.

Adapters may improve:

- page classification;
- stable control identification;
- step detection;
- validation parsing;
- confirmation detection.

They must not bypass generic safety, approval, or verification contracts.

### Phase 12 — Fixture/gating matrix

Priority: P0/P1

Create deterministic local fixtures and gates for all critical semantics.

Minimum gates:

- syntax/typecheck;
- contract/schema/route symmetry;
- capability risk-policy symmetry;
- semantic-control extraction;
- mutation verification;
- stale-revision rejection;
- approval receipt invalidation;
- workflow resume;
- human boundary;
- upload/download;
- submit verification;
- shared-browser non-interference;
- no secret/value leakage in diagnostics.

Root `npm test` should become a deterministic suite, not a single cleanup scenario.

### Phase 13 — Resource lifecycle and browser hygiene

Priority: P1

Build on the Console-owned browser improvements.

Network must:

- never launch a competing browser when using Console mode;
- bind only explicit targets;
- never close unrelated user/Console tabs;
- close Network-owned transient popup/auxiliary targets when safe;
- release target/workflow leases;
- garbage-collect abandoned runtime state;
- preserve durable workflow evidence separately from browser target lifetime.

Exit criteria:

- repeated form tasks do not produce unbounded tabs/processes/state.

### Phase 14 — Documentation and generated reference

Priority: P2

Generate a human-readable capability reference from Contract v2.

Reconcile/remove stale documents and legacy names.

Document:

- Console/Network boundary;
- workflow lifecycle;
- approval model;
- artifact model;
- supported control semantics;
- human boundaries;
- recovery;
- debugging;
- compatibility/deprecation.

### Phase 15 — Production acceptance scenarios

Priority: P1

Run supervised acceptance against representative real systems without final submit unless explicitly approved.

Acceptance scenarios should include:

- Greenhouse application with resume upload;
- Ashby application with custom questions;
- Workday multi-step form;
- GovernmentJobs/NEOGOV login boundary;
- Salesforce-style dynamic form;
- a generic non-job form to prove Network is not career-only.

Capture gaps as fixtures before fixing them.

## Proposed target capability groups

Instead of growing a flat tool list indefinitely, organize Network capabilities conceptually as:

### Runtime

- status;
- health;
- inventory;
- diagnostics.

### Target

- list;
- bind;
- open;
- transition;
- close-owned-target.

### Page

- snapshot;
- wait;
- classify;
- validation summary.

### Form

- inspect semantic model;
- diff revision;
- propose operation set;
- validate operation set.

### Mutation

- apply approved operations;
- upload artifact;
- click/advance;
- verify postconditions.

### Workflow

- create;
- status;
- resume;
- cancel;
- event stream.

### Review/submit

- build review artifact;
- mint approval receipt;
- submit approved revision;
- verify terminal confirmation.

### Artifact

- register local safe artifact;
- inspect metadata;
- download;
- retention/cleanup.

## Explicit non-goals

- no credential harvesting;
- no CAPTCHA bypass;
- no 2FA bypass;
- no silent final submission;
- no arbitrary filesystem access;
- no mass-apply crawler behavior;
- no second competing browser runtime when Console-owned browser mode is active;
- no site-specific adapter that bypasses semantic safety rules.

## Success definition

This milestone is complete when Network MCP can take a real multi-step external form from URL to verified pre-submit review with:

- one durable workflow ID;
- deterministic target/form identities;
- semantic field extraction;
- safe document upload;
- type-specific verified mutations;
- typed human boundaries;
- resumability across worker restart;
- exact approval binding;
- structured diagnostics;
- bounded browser/resource usage;
- deterministic regression coverage;
- no dependence on undocumented DOM indexes or global mutable page state.

Final submit may remain approval-gated and policy-disabled by default. The maturity target is reliable execution and evidence, not removal of human control.


