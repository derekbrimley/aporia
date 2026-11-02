# Glossary

The terms used across `docs/product/`. When a doc and this file disagree, this file wins, so fix the doc.

| Term | Meaning |
|---|---|
| **Associate** | The junior lawyer who plays the simulation. Their home is the inbox at `/`. |
| **PD admin** | Someone on a firm's professional development team. They see their firm's roster at `/pd` and can invite associates into their own firm. |
| **Internal admin** | A re:matter staff member. Their home is the admin console at `/admin`. |
| **Internal rater** | A re:matter staff member who rates associates' work. Their home is `/rater`. |
| **Role** | One of the four above. A user has exactly one role. |
| **Home** | The page a user lands on after signing in, decided by their role. |
| **Invited user** | A person with a row in the users table who hasn't been removed. Only invited users can sign in. Nobody can sign themselves up. |
| **Removed user** | An invited user that an admin later removed. They can't sign in, and any browser they were signed in on is signed out on its next request. |
| **Cohort** | A group of associates at one firm running the simulation together. An associate who isn't in a cohort can still sign in, but sees "Nothing here yet." |
| **Sign-in link** | The single-use link emailed to an invited user. It's valid for 20 minutes. The code calls it a *magic link*. |
| **SSO sign-in** | Signing in through the firm's identity provider via WorkOS. It only appears when WorkOS is configured, and it only matches invited users with a verified email. |
| **Signed-in browser** | A browser holding a valid sign-in cookie, which lasts 14 days. The code calls this an *auth session*. Don't shorten it to "session." |
| **Simulation session** | One associate's run through the deal. Plain "session" in these docs means this, not a signed-in browser. |
