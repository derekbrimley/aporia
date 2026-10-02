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
- **Observability.** Worker generations go to Langfuse (OpenTelemetry SDK, isolated tracer provider) with prompt, output, usage and checker result; worker exceptions and alerts, and web server request errors, go to Sentry. Both are off until keys are set; neither has been exercised against a live account yet. Browser-side errors are not captured. Alerts reach Sentry but not email/Slack.
- **Live updates poll Postgres every 2 s behind SSE** rather than LISTEN/NOTIFY. Fine at pilot scale.
- **Reply delays** follow `reply_delay_seconds` per character (30–120 s senior associate, 5–15 min partner, 2–10 min client, 10–30 min lender's counsel); tune in testing.
- **No at-send dialogs (engine 0.2).** The spec's at-send rationale sheet and the later "Is this your answer?" confirm were both removed; testers found them confusing and out of world. Reasoning is now judged from the email itself (`reasoning_quality` in the assessor), and the Socratic reflection asks the associate why they made each call. When the deliverable went to the client or lender, the reflection goes on a private `Internal: <subject>` side thread so outside parties never see it. The associate's first reply to a reflection is stored as their reasoning (assignment `reasoning`, and any empty `decisions.rationale`) and feeds the debrief; it is never assessed as work product. Legacy `rationale` fields on engine 0.1 events are still read.
- **Silent probe for question-shaped deliverables.** When the classifier calls an email of 60+ words a question or logistics, but it goes where an assessable deliverable is open (`likelyDeliverable`), the worker runs a probe assessment. The email is promoted to the deliverable if it takes a decision position or raises at least half the assignment's issues (`isWorkProduct`); otherwise the probe is discarded and the character replies as usual. Added after a staging tester's term sheet comments, written as questions with a "can you review these?" opener, were classified as a question and never assessed. Short deliverables still fall through: a one-line "deliverable" is read as a question, the assignment stays open, and the character replies. This is the spec's open question on an explicit "submit work product" control; it surfaced in the Weak path.
- **Idle nudges.** If an associate email leaves nothing for the world to do (an acknowledgment, or no one to reply) while a deliverable is open and no job is pending, the engine plans a `nudge` job 20 minutes out, at most twice per assignment. The worker drops it if anything has happened since; otherwise the assignment's feedback character checks in on its thread. Off in test mode, so bot runs and local dev never get them.
- **Forwarding (engine 0.3).** Any message except a practice support answer can be forwarded from its thread. A forward starts a new thread with a "Fwd:" subject, brings the original's attachments along, and stores the original as `forwardedMessageId` on `email_sent` rather than pasting it into the body. Recipients' prompts show it quoted beneath the note, and the fact checker accepts facts the forwarded email states. Only the associate's own words are assessed: a forward of someone else's email never counts as work product, but a forward of the associate's own earlier email does (`workText`), so resending comments to the right people can still deliver an assignment. Forwarding privileged or internal mail to the other side has no deal consequence yet.
- **The client does not separately reply to a deliverable addressed to her**; only the feedback character (senior associate) replies with Socratic questions. Add a `generated` beat if the attorney wants Priya to acknowledge too.
- **Assessor shadow mode** is implemented per cohort (`assessor_shadow_mode`): assessments are logged but do not complete assignments or seed consequences. In shadow mode the deal does not advance past a deliverable until a human confirms; a confirm screen is not built yet.
- **Rater pseudonymization** hides names/emails/firm at the query level (ids only). Message bodies are shown verbatim; associates could name themselves in an email.
- **Mobile** is out of scope; layout is fixed for 1280px and up.

## Not started

- Legal and security documents (one-pager, subprocessor list, ToS, privacy policy, pilot agreement).
- Playwright end-to-end tests (config placeholder only).
- Shadow-mode confirmation UI; email/Slack alerting; Notion import verified against the live workspace; data-retention job (delete after pilot + 12 months).
