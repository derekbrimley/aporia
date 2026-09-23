# Build status against the V1 spec

Date: 2026-09-23. Branch `claude/inspiring-pasteur-uz991g`.

## Build track

| Phase | Exit criterion | Status |
|---|---|---|
| 0. Foundations | Create a firm, cohort and associate; associate signs in | Done. Seed script + admin console create them; magic-link sign-in works (WorkOS AuthKit adapter written, untested without keys). |
| 1. Scenario package | M1–M3 content imports and validates | Done for schema/validator/builder. Content is engineering DRAFT, not imported from Notion (the deal bible is still a template). Import script written, untested without `NOTION_TOKEN`. |
| 2. Headless engine | CLI playthrough of M1–M3 completes | Done, and through M8: `pnpm playthrough` completes the full arc with the mock provider. |
| 3. Eval harness | Nightly suite runs on M1–M3; first kappa measured | Harness, five paths, checks, judge and kappa done; 10/10 mock runs pass. Kappa needs attorney ratings (rating screen built). |
| 4. Inbox UI | Attorney plays M1–M3 in the browser without help | Built to the "Latest (Oat and Plum)" mocks; production build passes. Needs a real-model, human playthrough. |
| 5. Full arc | 20-run suite passes | Engine and beats cover M4–M8 with skeleton content; passes with mock. Real content (deltas, verification packets, negotiation positions, documents) is the attorney's critical path. |
| 6. Pilot readiness | Every pre-pilot criterion met | PD view, admin console, held-email queue, flag triage, audit log done. Alerts log to stderr (hook for email/Slack). Security one-pager, subprocessor list, ToS, privacy policy, pilot agreement: not written (legal documents). |

## Deviations and gaps to decide

- **Product name.** The sign-in mock says "Associate Reps"; the repo is "aporia". `PRODUCT_NAME` env defaults to "Associate Reps".
- **Documents are Markdown, not .docx via pandoc.** No attorney-approved .docx exists yet, and pandoc is not in this environment. The builder accepts `.docx` sources and shells out to pandoc when present. "Download PDF" opens a print-ready page (browser print-to-PDF) instead of a pre-rendered PDF.
- **Observability vendors not wired.** Generations are traced to structured logs and the `generations` table; Langfuse and Sentry plug into `apps/worker/src/telemetry.ts`. Alerts (held email, job failed after retries) are logged, not sent.
- **Live updates poll Postgres every 2 s behind SSE** rather than LISTEN/NOTIFY. Fine at pilot scale.
- **Reply delays** follow `reply_delay_seconds` per character (30–120 s senior associate, 5–15 min partner, 2–10 min client, 10–30 min lender's counsel); tune in testing.
- **Short deliverables can be classified as questions.** A one-line "deliverable" is reasonably read as a question by the classifier, so the assignment stays open and the character replies. This is the spec's open question on an explicit "submit work product" control; it surfaced in the Weak path.
- **The client does not separately reply to a deliverable addressed to her**; only the feedback character (senior associate) replies with Socratic questions. Add a `generated` beat if the attorney wants Priya to acknowledge too.
- **Assessor shadow mode** is implemented per cohort (`assessor_shadow_mode`): assessments are logged but do not complete assignments or seed consequences. In shadow mode the deal does not advance past a deliverable until a human confirms; a confirm screen is not built yet.
- **Rater pseudonymization** hides names/emails/firm at the query level (ids only). Message bodies are shown verbatim; associates could name themselves in an email.
- **Mobile** is out of scope; layout is fixed for 1280px and up.

## Not started

- Legal and security documents (one-pager, subprocessor list, ToS, privacy policy, pilot agreement).
- Playwright end-to-end tests (config placeholder only).
- Shadow-mode confirmation UI; alerting integrations; Langfuse/Sentry SDKs; Notion import verified against the live workspace; data-retention job (delete after pilot + 12 months).
