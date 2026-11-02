# Bug triage

This file lists everything in `docs/product/` that looks wrong, merged by root cause. B-01 to B-08 come from the sign-in pilot and were checked in the running app where possible. B-10 to B-19 come from the 2026-11-02 state machine audit of `cfea6fe`. They're pinned to code but haven't been re-verified as product docs yet, so they become verified as their feature docs get written.

**Summary.** #11 (merged 2026-11-02, `506e147`) fixed the top five problems: link scanners using up sign-in links (B-01, plus B-02), out-of-order beats (B-10), late assessments overwriting results (B-11), stalled deals (B-12) and replay wiping read state (B-13). Nothing open is high severity now. The most visible remaining issue for testers is B-03, where the sign-in form freezes on a failed request. After that come the worker and held-email timing issues (B-14, B-15). Everything else is recoverable or cosmetic.

| ID | Title | Severity | Area | Decision | Status |
|---|---|---|---|---|---|
| B-01 | Link scanners use up sign-in links | high | sign-in | fix | fixed in #11 |
| B-10 | "After" beats wait for queued, not delivered | high | simulation | fix | fixed in #11 |
| B-11 | A second deliverable overwrites a completed assessment | high | assessment | fix | fixed in #11 |
| B-12 | A failed job or discarded held email stalls the deal | high | simulation | fix | fixed in #11 |
| B-03 | The sign-in form freezes when the request fails | medium | sign-in | fix | open |
| B-02 | Using a link isn't atomic | medium | sign-in | fix | fixed in #11 |
| B-13 | Replay marks every email unread | medium | admin | fix | fixed in #11 |
| B-14 | Workers act on a snapshot from before the LLM call | medium | simulation | fix | open |
| B-15 | The held-email pipeline isn't atomic | medium | admin | fix | partly fixed in #11 |
| B-16 | The engine version pin isn't enforced | medium | simulation | product call | open |
| B-17 | Inbox loads can apply out of order | medium | inbox | fix | open |
| B-18 | Active minutes measure the wrong gaps | medium | PD roster | fix | open |
| B-05 | No limit on sign-in link requests | medium | sign-in | product call | open |
| B-04 | A removed user's old link says "expired" | low | sign-in | fix | open |
| B-06 | The "on its way" copy mentions cohorts | low | sign-in | fix | open |
| B-07 | Email send failures are silent | low | sign-in | product call | open |
| B-08 | The SSO "not invited" message covers every failure | low | sign-in | fix | open |
| B-19 | Smaller state machine gaps (grouped) | low | various | fix | open |

## Sign-in

### B-01 Link scanners use up sign-in links

- **Where the user meets it:** they click the sign-in link in their email.
- **What happens:** the user lands on "That link has expired or was already used." A corporate scanner (Outlook Safe Links, Mimecast or Proofpoint) opened the link first, and that open counted as the sign-in. **Expected:** the person's own click signs them in.
- **Reproduce:** request a link, GET it once with curl, then open it in a browser. (SI-24)
- **Why:** a plain GET to `/api/auth/callback` uses up the token (`apps/web/src/app/api/auth/callback/route.ts:5-9`, `apps/web/src/lib/auth.ts:42-48`).
- **Severity:** high. It locks testers out, and law firms almost always run a scanner.
- **Decision needed:** fix. The GET should show a "Sign in" button that POSTs. Only the POST uses the token.
- **Raised by:** state machine audit finding 4; features/sign-in.md §5.4.
- **Status:** fixed in #11. The emailed link now opens a confirm page, and only its **Continue** button (a POST) uses up the token. Re-verified against `506e147` (SI-24, SI-27). It still hasn't been tested against a real scanner.

### B-02 Using a link isn't atomic

- **Where the user meets it:** they don't, normally. It would show up as two browsers signed in from one link.
- **What happens:** the app checks that the link is unused, then marks it used in a separate statement. Two requests at the same instant can both pass the check. **Expected:** exactly one sign-in.
- **Reproduce:** 5 parallel GETs of one link (SI-10). This didn't reproduce locally, where only one won.
- **Why:** `apps/web/src/lib/auth.ts:44-46` selects the unused link, then updates it without `where used_at is null`.
- **Severity:** medium. Only someone who already holds the link can exploit it, but single use is a security promise.
- **Decision needed:** fix with `update … where used_at is null and expires_at > now() returning user_id`.
- **Raised by:** audit finding 4.
- **Status:** fixed in #11 with a single guarded `UPDATE … RETURNING` (`apps/web/src/lib/auth.ts:42-52`). Re-verified with 10 parallel POSTs, of which exactly one signed in (SI-10).

### B-03 The sign-in form freezes when the request fails

- **Where the user meets it:** they press **Send me a sign-in link** on a bad connection, or while the server is erroring.
- **What happens:** the button stays disabled and nothing is shown. The only way out is reloading the page. **Expected:** a message, and the button comes back.
- **Reproduce:** block or 500 `/api/auth/magic-link` in the browser, then submit (SI-22).
- **Why:** `submit` sets `busy: true` and has no `try/catch` and no `r.ok` check, so `fetch` rejecting or `r.json()` throwing leaves `busy` set forever (`apps/web/src/components/SignInForm.tsx:7-13`).
- **Severity:** medium. The user can recover, but the page gives no clue how.
- **Decision needed:** fix.
- **Raised by:** features/sign-in.md §5.4.
- **Status:** verified (fail).

### B-05 No limit on sign-in link requests

- **Where the user meets it:** anyone can make the app email an invited address over and over.
- **What happens:** 20 requests in a row created 20 links, all valid for 20 minutes. With Postmark on, that's 20 emails. **Expected:** some limit, and maybe voiding older links.
- **Reproduce:** SI-23.
- **Why:** `apps/web/src/app/api/auth/magic-link/route.ts:3-9` and `createMagicLink` (`apps/web/src/lib/auth.ts:20-39`) have no throttle.
- **Severity:** medium. It allows inbox flooding and burns the Postmark quota, though it's harmless during a small tester cohort.
- **Decision needed:** product call. One option is a per-address limit (say 5 per 15 minutes), which costs nothing visible. The other is voiding older links on each request, which is stricter but breaks "I clicked the first email."

### B-04 A removed user's old link says "expired"

- **Where the user meets it:** a removed user clicks a link that was emailed before they were removed.
- **What happens:** "That link has expired or was already used." The link is used up, and a signed-in browser row is created that can never be used. **Expected:** no sign-in, plus a message saying their access ended.
- **Reproduce:** SI-29. It's still present after #11.
- **Why:** `consumeMagicLink` doesn't check `removed_at`. `signIn` inserts the auth session, then `getCurrentUser` filters the user out and returns null (`apps/web/src/lib/auth.ts:42-61`, `:81`).
- **Severity:** low.
- **Decision needed:** fix. Check `removed_at` before marking the link used, and show the `not_invited` message.

### B-06 The "on its way" copy mentions cohorts

- **What happens:** "If that address is on a cohort, a sign-in link is on its way." PD admins, admins and raters aren't in cohorts and do get links. An associate without a cohort also gets one.
- **Why:** `apps/web/src/components/SignInForm.tsx:17`.
- **Severity:** low (copy).
- **Decision needed:** fix, for example "If that address has been invited, a sign-in link is on its way."

### B-07 Email send failures are silent

- **What happens:** if Postmark rejects the send (an unverified sender, a bad token, a suppressed address), the page still says the link is on its way, and the error only shows up in the server logs.
- **Why:** `apps/web/src/lib/auth.ts:33-35`. This is deliberate, so the form doesn't reveal who's invited.
- **Severity:** low, but it's hard to diagnose during tester onboarding.
- **Decision needed:** product call. Keep it silent, but alert on `postmark_failed` (Sentry is already wired up) so the team finds out before the tester does.

### B-08 The SSO "not invited" message covers every failure

- **What happens:** when the WorkOS code exchange fails or the email is unverified, the user is told "That account has not been invited to a cohort."
- **Why:** `workosSignIn` returns null for all three cases (`apps/web/src/lib/auth.ts:130-136`), and the callback maps null to `not_invited` (`apps/web/src/app/api/auth/workos/callback/route.ts:13`).
- **Severity:** low. Not verified, because WorkOS isn't configured locally.
- **Decision needed:** fix. Use separate error codes.

## From the state machine audit

The full write-up with scenarios is in the audit doc: https://claude.ai/artifact/1PawrbLUzgwnDWzb5pd4PN. Line numbers are at `cfea6fe`. B-10 to B-13 were fixed in #11, which has engine tests for each. The rest are still open and haven't been re-verified as product docs.

- **B-10 (fixed in #11) "After" beats wait for queued, not delivered** (`packages/engine/src/step.ts:433`). In M3, Marcus's "Jordan's drafts just landed" opens A3 10–29 minutes before the drafts arrive. The same thing happens in M4, M6 and M8.
- **B-11 (fixed in #11) A second deliverable overwrites a completed assessment** (`step.ts:183-189`, `:291-295`, `:321`). The stored issue statuses can contradict the consequences and the debrief, and the associate gets a second reflection.
- **B-12 (fixed in #11) A failed job or discarded held email stalls the deal** (`step.ts:61`, `apps/worker/src/held.ts:122`). The beat stays "enqueued" forever. If it opens an assignment, the inbox just goes quiet.
- **B-13 (fixed in #11) Replay marks every email unread** (`packages/db/src/projections.ts:236`, `:279`).
- **B-14 Workers act on a snapshot from before the LLM call** (`runner.ts:33`, `handlers.ts:224`, `held.ts:114`). Stale nudges arrive after the work was sent.
- **B-15 (partly fixed in #11) The held-email pipeline isn't atomic** (`runner.ts:43-49`, `held.ts:115-118`). #11 made release and discard each one transaction that locks the held row, which closes scenario B. Scenario A is still open: the worker still inserts the held row before it appends `message_held`.
- **B-16 The engine version pin isn't enforced** (`packages/db/src/runtime.ts:115`). This is a product call: either honor the pin, or migrate sessions on deploy.
- **B-17 Inbox loads can apply out of order** (`InboxApp.tsx:65`). The stream also ignores `assessment_recorded` (`stream/route.ts:23`).
- **B-18 Active minutes measure the wrong gaps** (`projections.ts:213-214`, `runtime.ts:192`).
- **B-19 Grouped low-severity items:**
  - The consequence `resolved` state is never set.
  - The nudge cap counts dropped nudges.
  - Shadow mode re-assesses extra deliverables.
  - Flag status accepts any string.
  - Re-inviting a user ignores the new role.
  - The first load isn't idempotent.
  - Send checks for "completed" before taking the lock.
  - Cohort dates aren't enforced.
  - Deleting the draft isn't tied to the send.
