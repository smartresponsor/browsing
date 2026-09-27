# Transfer Memo: Career Application Workflow

Date: 2026-06-28
Owner: Oleksandr Tishchenko
Repository: `D:\PhpstormProjects\www\mcp\network-mcp`
Primary tracker: `docs/career-application-tracker.md`

This memo is a clean handoff for the supervised career-application workflow. It intentionally excludes the separate MCP/OAuth/tunnel repair sub-track. The next session should use this document to resume application work, verify tool availability, open target links, inspect forms, prepare answers, and proceed only with explicit user approval for any fill or submit action.

## Operating rule for the next session

Do not restart the MCP repair discussion unless the user asks. First try the available `network-mcp` tools against the application links below.

Preferred first tool test:

```text
network.open("https://careers.uh.edu/jobs/es-application-developer-ii-iii-on-site-broadband-posting-houston-texas-united-states")
```

If the page opens, continue with:

```text
network.inspect()
network.extract_form()
```

Do not use `network.fill_after_approval` unless the user explicitly approves the exact fields. Never perform final submit automatically.

## User profile for applications

Candidate: Oleksandr Tishchenko

Contact:

- Email: `o.tishchenkofamily@gmail.com`
- Phone: `+1 346-883-2743`
- LinkedIn: `https://www.linkedin.com/in/trusted-software-engineer/`
- Website: `https://smartresponsor.com`
- Docs: `https://docs.smartresponsor.com`
- GitHub: `https://github.com/smartresponsor`
- Location: Houston, TX area

Default application answers already recorded in the tracker:

- Sponsorship now: No
- Sponsorship in the future: No
- Gender: Male
- Hispanic / Latino: No
- Race: White
- Veteran: No
- Disability: No

Work authorization posture:

- The search target is public-sector, university, government-adjacent, and institutionally stable employers.
- User is seeking roles compatible with I-9/TPS/EAD style work authorization.
- Do not invent citizenship, clearance, PeopleSoft, Java, Oracle, or public-sector domain experience. Use transferable backend/platform/automation experience honestly.

## Current submitted application baseline

The following applications are already marked submitted in `docs/career-application-tracker.md`:

- Anthropic: multiple engineering/research roles.
- OpenAI: multiple backend/cooperative AI/API SDK/evals roles.
- Salesforce: CTO - Agentic Process Automation & Intelligence.
- California Department of Justice: Software Application Developer / Information Technology Specialist I, JC-520158.
- University of Houston: ES Application Developer II, 496190.

Next session should not resubmit these unless the user explicitly requests a duplicate or follow-up action.

## Active public-sector / university pipeline

### 1. University of Houston — ES Application Developer II/III On-site, Broadband Posting, 496345

URL:

```text
https://careers.uh.edu/jobs/es-application-developer-ii-iii-on-site-broadband-posting-houston-texas-united-states
```

Prior state:

- Public page was opened earlier.
- Apply CTA was the blocking step.
- Page showed prefilled/disabled Oleksandr identity fields and interest/job-alert/referral CTA forms.
- Good target for supervised browser workflow once `network.open` and click/inspect tools work.

Fit angle:

- Enterprise systems, backend engineering, PHP/Symfony/SQL, production support, internal workflow automation.
- Medium/high fit even if PeopleSoft exposure is limited.
- Keep PeopleSoft answers honest: no direct PeopleSoft development/support unless the form allows a transferable-experience explanation.

Next action:

1. Open URL with `network.open`.
2. If visible browser opens, click Apply only if it is a non-final navigation button.
3. Inspect application form.
4. Prepare proposed answers for user review.
5. Fill only after explicit approval.
6. Stop before final submit and capture review artifact.

### 2. King County — Principal Power Platform Solutions Engineer, 2026-27449

URL:

```text
https://www.governmentjobs.com/careers/kingcounty/jobs/5374788/principal-power-platform-solutions-engineer
```

Prior state:

- Blocked by GovernmentJobs/NEOGOV login.
- User login/support likely needed.
- No password automation.

Fit angle:

- Principal-level public-sector process automation.
- Power Platform can be framed via workflow automation, governance, integration, data operations, and supervised automation.
- Good networking/stretch application.

