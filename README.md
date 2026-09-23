# Aporia: Simulation 01 (Venture Debt)

A borrower-side venture debt financing, run from kickoff to closing inside an email inbox where every other participant is played by AI. Built from the Notion spec "V1 Build Spec: Simulation 01 (Venture Debt)".

**Architectural stance:** scenario content is data (`packages/scenario`), the simulation engine is deterministic code (`packages/engine`), and the LLM voices characters and asks questions (`apps/worker`). The LLM never decides deal state and never authors legally substantive text at runtime.

> **Content status: DRAFT.** The `venture-debt-01` scenario package was authored by engineering from the PRD and build spec so the system could be built and exercised end to end. Every fact, issue, delta, consequence and document must be replaced or approved by the attorney cofounder before any cohort sees it. `pnpm scenario:validate` prints this warning until `scenario.yaml` is marked `attorney_reviewed`.

## Layout (pnpm workspaces)

| Package | What it owns |
|---|---|
| `packages/scenario` | Zod schemas for the scenario package, loader + cross-reference validator, fact slicing per character, Markdown→HTML document builder with section anchors, Notion import script, the `venture-debt-01` package |
| `packages/engine` | Pure `step(state, event, scenario) → { state, effects }`, replay, milestone/assignment/consequence/beat logic, job planning, deterministic delays |
| `packages/db` | Drizzle schema (every table org-scoped), append-only `events` (DB trigger enforced), transactional `appendEvent` that steps the engine, writes projections and enqueues graphile-worker jobs; snapshot cache; seed |
| `packages/prompts` | Pinned model config per role; versioned prompt builders for the eight LLM roles and the bot associate |
| `apps/worker` | LLM providers (Anthropic, Bedrock, deterministic mock), two-layer fact checker, job handlers, delivery/hold, graphile-worker runner (one serial lane per session), held-email release |
| `packages/evals` | Bot-associate harness with five path files, automatic checks, offline judge, Cohen's kappa, run reports |
| `apps/web` | Next.js inbox (Oat and Plum), compose with at-send sheet, document panel (compare/replace/close, quote in reply, layout switch), live updates, tester flags, sign-in, PD roster, internal admin console, rater view |

## Run it locally

Requirements: Node 22, pnpm 10, Postgres 16.

```bash
pnpm install
cp .env.example .env            # defaults: local Postgres, mock LLM, test mode
createdb aporia_dev
pnpm scenario:validate          # schema + cross-reference check of the scenario package
pnpm scenario:build-docs        # Markdown -> HTML with section anchors
pnpm db:migrate                 # SQL migrations + graphile-worker schema
pnpm db:seed                    # dev firm, cohort, associate/pd/admin/rater users, one session
pnpm dev:worker                 # in one terminal
pnpm dev:web                    # in another; open http://localhost:3000/sign-in
```

Sign in as `associate@dev-firm.example` (or `pd@…`, `admin@…`, `rater@…`). Without Postmark configured, the magic link is printed in the web server log and, in development, returned to the sign-in form.

Set `LLM_PROVIDER=anthropic` plus `ANTHROPIC_API_KEY` for real generations (`bedrock` + AWS credentials for firms that require AWS). Unset `APORIA_TEST_MODE` to get realistic per-character reply delays.

## Tests and evals

```bash
pnpm test:unit                  # scenario, engine, prompts, worker, evals (no DB)
pnpm test:db                    # event log runtime against DATABASE_URL
pnpm playthrough -- --path mixed   # one headless bot run through closing (mock LLM by default)
pnpm evals:fast                 # 3 × Mixed (what CI runs on every PR)
pnpm evals:nightly              # 4 × each of the 5 paths, with the judge when a real provider is set
```

Run reports land in `packages/evals/runs/`. With the mock provider, 10/10 runs across all five paths pass every automatic check; the judge and kappa gates only mean something with a real model and attorney ratings.

## How a send becomes state

1. The associate presses Send. `POST /api/inbox/send` runs the fast intent classifier. If the email is a deliverable and the thread (or recipients) has an open decision point, the API returns `needsRationale` and the at-send sheet opens; nothing has left yet. "Not my answer yet" sends it as a question.
2. The API appends `email_sent` (with intent and private rationale). `appendEvent` steps the engine in the same transaction, writes projections and enqueues jobs on the session's serial lane.
3. The worker runs the assessor (structured output mapping the work to issue/decision IDs), appends `assessment_recorded`; the engine completes the assignment, seeds consequences, plans the Socratic reflection and the next beats; the worker writes each email, runs the fact checker (rules, then model), regenerates up to twice, and either appends `message_delivered` or holds the email for admin release.
4. The inbox receives the new message over server-sent events.

Every LLM call is recorded in `generations` (role, model, prompt version, inputs, output, tokens, latency, checker result). Every session is pinned to a scenario version and engine version; a scenario update never changes an in-progress session.

## Scenario authoring

Content lives in `packages/scenario/scenarios/venture-debt-01/`. The engine fires consequences off IDs, never prose: issues are `A#.I#`, decision points `A#.D#` with positions `P#`, and every consequence seed points at one of them. `pnpm scenario:import` (needs `NOTION_TOKEN` and a `notion-sources.yaml`) pulls the deal bible tables into the YAML files and lists every field it could not map. Documents are Markdown today; when attorney-approved `.docx` files exist, point the register at them and the builder runs pandoc.

## Deploying

Web and worker are plain Node processes (Railway); Postgres is Neon; the queue is graphile-worker on Postgres, so there is no extra vendor. `RUN_MIGRATIONS_ON_START=1` on the worker applies migrations at boot. See `.env.example` for every variable and `docs/STATUS.md` for what is and is not done.
