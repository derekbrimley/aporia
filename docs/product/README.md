# re:matter product description

## Purpose

This folder describes what re:matter does from the outside, one feature at a time. It covers what a person sees, what happens when they act, and what happens when they stop halfway or something goes wrong. It's written from the code and tests and then checked against the running app.

What this is not:

- Not API or code documentation, and not organized by package. Code only appears in blocks labeled **Technical note:**.
- Not a spec of what the product *should* do. When behavior looks wrong, the doc says what actually happens and the problem goes into [bug-triage.md](bug-triage.md).

The method comes from Steve Ruiz's `product-description` skill ([gist](https://gist.github.com/steveruizok/83ae5c53f2784ebf8f5fe0a3fb94480f)). This folder started as a pilot of that method on one feature.

## Conventions

- Describe the experience, not the code. Headings are in sentence case.
- [glossary.md](glossary.md) is the source of truth for terms. Use its words, especially for "session," which can mean two different things.
- Every doc ends with the commit it was verified against and its open questions.
- Surprising behavior is stated plainly, not smoothed over.

## The document template

Every feature doc uses the same eight sections:

1. **Summary**
2. **The simple case**
3. **The interaction, event by event.** It has five slots, renamed in the product's words: starting, ending at once, becoming extended, while extended, and finishing. The section includes a state diagram.
4. **Modifiers.** A table of the variations.
5. **Cancel and interrupt.** The same seven families appear in every doc, in this order:
   1. explicit abort
   2. the user doing something else mid-way
   3. clean "complete" events
   4. the environment failing
   5. the page or process going away
   6. something else changing the target
   7. the input channel changing
6. **Interactions with other systems.** The fixed order is permissions, history/undo, containers, locked/read-only, offline, collaboration, notifications, and configuration.
7. **Edge cases**
8. **Open questions and verification**

A small feature runs about 150–200 lines.

## Method

For each feature:

1. Read the state code and domain objects.
2. Read the matching tests.
3. Draft the doc.
4. Check the ambiguous points in the running app.
5. Record the verified commit.

## Verification

[verification/](verification/) holds one checklist per doc. Each item is one observable claim with its setup, steps, expected result and priority. Results are pass, fail or blocked. A failure goes into [bug-triage.md](bug-triage.md) with the item's ID. A doc counts as **verified** only when every P1 and P2 item has passed or been filed.

## Order of work

1. Pilot feature: sign-in (done).
2. Foundations: the glossary, then the simulation session, milestones, assignments and beats.
3. The hardest area: sending a deliverable, then assessment, then reflection.
4. Everything else in parallel (inbox, document panel, compose, tester flags, PD roster, admin console, rater view). After that come a consistency pass and a verification pass.

## Structure

```
docs/product/
  README.md            this file
  glossary.md          terms
  bug-triage.md        everything that looks wrong, deduplicated by root cause
  features/
    sign-in.md
  verification/
    sign-in.md
```

## Coverage

| Area | Doc | Status |
|---|---|---|
| Sign-in and sign-out | [features/sign-in.md](features/sign-in.md) | verified (local, `cfea6fe`) |
| Simulation session, milestones, beats | | not started |
| Sending a deliverable, assessment, reflection | | not started |
| Inbox and live updates | | not started |
| Document panel | | not started |
| Compose and drafts | | not started |
| Tester flags | | not started |
| PD roster | | not started |
| Admin console (cohorts, invites, held emails, replay) | | not started |
| Rater view | | not started |
