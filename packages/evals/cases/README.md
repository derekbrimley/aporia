# Eval cases from tester flags

Each `.json` file here is one moment a tester flagged: the session's events up to the flagged email,
the job that wrote it, and what the tester said. `pnpm evals:cases` rebuilds that moment without a
database, writes the email again with the current prompts and code, and asks a judge whether the
tester's problem comes back.

**Making a case**

- In the app: Admin, Tester flags, then **Eval case** on a flag. It downloads `<case id>.json`; save it here.
- From the command line: `pnpm evals:cases --make <flag id>` with `DATABASE_URL` pointing at the
  database the flag is in (for staging, run it under `railway run`).

Testers can flag an email ("Flag as unrealistic"), or a whole conversation ("Stuck or going in
circles?"). A conversation flag replays the last character email on it before the flag, since that
is the email that should have moved things along. Document flags are about scenario content, so they
don't become cases.

Then edit `expectation` in the file to say what should happen instead (it starts as the tester's
note). `samples` (default 5) is how many times the email is written again on a real model, and
`maxRepeats` (default 0) is how many of those may still show the problem.

**Running**

```bash
pnpm evals:cases                 # every case here; mock model unless LLM_PROVIDER says otherwise
pnpm evals:cases --samples 1     # cheaper
```

On the mock model a case only proves it still replays against the current scenario and engine. The
real check needs the real model, which the weekly real-model workflow runs.

**Privacy.** Case files hold the tester's own emails (the associate is renamed to Sam, but the text is
theirs). This repository is public, so `*.json` files here are gitignored by default. Commit one only
with the tester's OK, with `git add -f`.
