# Verification: sign-in

These items check [features/sign-in.md](../features/sign-in.md). They were run on 2026-11-02 against `cfea6fe`, on a local stack: Postgres 16, `pnpm db:seed`, `pnpm dev:web`, `.env.example` defaults (so no Postmark and no WorkOS). The API checks used curl, and the UI checks used headless Chromium.

Priority: P1 means someone can't get in or gets in wrongly. P2 means a wrong message or a stuck state. P3 is copy or cosmetic.

| ID | Claim | Setup | Steps | Expected | P | Result |
|---|---|---|---|---|---|---|
| SI-01 | An invited user gets a link | seeded associate | POST `/api/auth/magic-link` with their email | `{ok:true}`, with a dev link because there's no Postmark | P1 | pass |
| SI-02 | An uninvited address looks the same | none | POST with `nobody@nowhere.example` | `{ok:true}`, no link, no row | P1 | pass |
| SI-03 | Case and spaces are ignored | seeded associate | POST `"  Associate@Dev-Firm.example "` | link issued | P2 | pass |
| SI-04 | Missing email is rejected | none | POST `{}` | 400 `email required` | P3 | pass |
| SI-05 | A link signs in and lands on the role's home | links for the associate, PD and admin | open each link | `/`, `/pd`, `/admin`; cookie set | P1 | pass |
| SI-06 | A link works once | used link | open it again | `/sign-in?error=expired` | P1 | pass |
| SI-07 | An expired link is refused | link with `expires_at` in the past | open it | `/sign-in?error=expired` | P1 | pass |
| SI-08 | Unknown or missing token | none | open `?token=junk`, and the callback with no token | `/sign-in?error=expired` | P2 | pass |
| SI-09 | Earlier links stay valid | two links requested | open the second, then the first | both sign in | P2 | pass (behavior noted in the doc) |
| SI-10 | Concurrent clicks sign in once | one link | 5 parallel GETs | exactly one sign-in | P1 | pass locally; the race is still open in code (B-02) |
| SI-11 | Signed-in users skip the form | signed-in associate | open `/sign-in` | redirect to `/` | P2 | pass |
| SI-12 | Wrong role is redirected home | signed-in associate | open `/admin` | redirect to `/` | P1 | pass |
| SI-13 | Signed-out users are sent to sign-in | no cookie | open `/` | redirect to `/sign-in` | P1 | pass |
| SI-14 | Sign-out ends that browser's sign-in | signed-in browser | POST `/api/auth/sign-out`, then reuse the old cookie | 303 to `/sign-in`; old cookie is refused | P1 | pass |
| SI-15 | GET doesn't sign out | none | GET `/api/auth/sign-out` | 405 | P3 | pass |
| SI-16 | Removing a user signs them out | signed-in associate, then `removed_at` set | open `/` | redirect to `/sign-in`; a new request issues no link | P1 | pass |
| SI-17 | A link from before removal doesn't sign in | link issued, then user removed | open the link | no sign-in | P1 | pass; the message says "expired" (B-04) |
| SI-18 | An associate without a cohort | associate with no `cohort_members` row | sign in | lands on `/`: "Nothing here yet. You are not in a cohort yet…" | P2 | pass |
| SI-19 | Error messages | none | open `?error=expired`, `not_invited`, `state`, `zzz` | the three messages in the doc; the unknown value gets the generic one | P3 | pass |
| SI-20 | SSO is hidden when WorkOS isn't configured | no WorkOS env | open `/sign-in`; GET `/api/auth/workos/start` | no SSO button; 404 JSON | P2 | pass |
| SI-21 | Bad SSO state is refused | none | GET the WorkOS callback with mismatched state | `/sign-in?error=state` | P1 | pass |
| SI-22 | The form recovers from a failed request | request aborted, or a 500 HTML response | press the button | an error message appears and the user can retry | P2 | **fail**: the button stays disabled with no message (B-03) |
| SI-23 | Link requests are limited | invited user | 20 requests in a row | some limit | P2 | **fail**: 20 valid links created (B-05) |
| SI-24 | A scanner doesn't use up the link | link | GET it once (as a scanner would), then click | the click still signs in | P1 | **fail**: the click gets "expired" (B-01) |
| SI-25 | SSO happy path | WorkOS configured, verified invited email | sign in with SSO | lands on home | P1 | blocked: no WorkOS credentials locally |
| SI-26 | Email delivery | Postmark configured | request a link | email arrives with the link | P1 | blocked: no Postmark locally |
