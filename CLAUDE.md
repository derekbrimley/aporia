# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Aporia is an inbox-based venture debt deal simulation for junior transactional associates. Every other participant (senior associate, partner, client, lender's counsel) is played by an LLM. `README.md` covers setup; `docs/STATUS.md` tracks what is done, known deviations from the V1 spec, and what hasn't been started.

## Commands

pnpm workspaces (Node 22+, pnpm 10, Postgres 16). The TypeScript runs directly through `tsx` and Next's transpiler, so no build step is needed during development.

```bash
pnpm typecheck                  # tsc --noEmit in every package
pnpm lint                       # prettier --check (the only linter; not in CI, and the repo isn't clean)
pnpm test:unit                  # vitest "unit" project: no DB needed
pnpm test:db                    # vitest "db" project: needs DATABASE_URL and a migrated DB
pnpm vitest run packages/engine/src/__tests__/engine.test.ts   # single file
pnpm vitest run --project unit -t "name of test"               # single test by name

pnpm scenario:validate          # schema + cross-reference check of the scenario package
pnpm scenario:build-docs        # Markdown -> HTML documents (output is gitignored; run before evals/web)
pnpm db:migrate                 # applies packages/db/migrations/*.sql, then graphile-worker's schema
pnpm db:seed
pnpm dev:worker / pnpm dev:web  # run both for the app (http://localhost:3000/sign-in)

pnpm playthrough -- --path mixed   # one headless bot run through closing
pnpm evals:fast                 # 3 × mixed path (CI runs this)
pnpm evals:nightly              # 4 × each of the 5 paths + judge
pnpm --filter @aporia/web e2e   # Playwright smoke test
```

CI (`.github/workflows/ci.yml`) runs validate → build-docs → typecheck → test:unit → db:migrate → test:db → evals:fast, with `LLM_PROVIDER=mock` and `APORIA_TEST_MODE=1`.

Don't run `pnpm format`: most files predate Prettier and it rewrites the whole repo. Format only the files you touch with `pnpm exec prettier --write <files>`, and only if they were already clean.

Test placement: unit tests are `**/__tests__/*.test.ts` in engine, scenario, prompts, worker and evals. Tests that touch Postgres must live in `packages/db` or be named `*.db.test.ts`, which keeps them in the serial `db` project. See `vitest.config.ts`.

Env: CLIs and the worker load the nearest repo-root `.env` through `loadEnv()` in `packages/db/src/env.ts`, and variables already exported take precedence. Next.js loads `.env` itself. `LLM_PROVIDER=mock` (the default) makes runs deterministic and needs no API key. `APORIA_TEST_MODE=1` sets every reply delay to zero.

## Architecture

**Core rule: scenario content is data, the engine is deterministic code, and the LLM only voices characters and asks questions.** The LLM never decides deal state and never writes legally substantive text at runtime. New behavior that changes deal state belongs in the engine or the scenario YAML, not in a prompt.

Dependency direction: `scenario` ← `engine` ← `db` ← `worker` / `prompts` ← `evals` ← `web`.

- **`packages/scenario`** holds the Zod schemas, loader, cross-reference validator and document builder, plus the `venture-debt-01` package (YAML files, `characters/`, `documents/`). Everything the engine reacts to is keyed by ID, never by prose: issues are `A#.I#`, decision points are `A#.D#` with positions `P#`, and every consequence seed points at one of them. The content is an engineering **DRAFT** until the attorney cofounder approves it (`attorney_reviewed` in `scenario.yaml`), so don't treat it as authoritative legal content.
- **`packages/engine`** exposes `step(state, event, scenario, opts) → { state, effects }`. It must stay pure: no I/O, no randomness, and no clock other than `event.at`. It never mutates its input. Effects include `enqueue_job` (jobs carry a `key` and `delaySeconds`). State carries `ENGINE_VERSION` (`types.ts`), and sessions are pinned to both a scenario version and an engine version.
- **`packages/db`** contains the Drizzle schema, with every table org-scoped. Migrations are hand-written SQL in `migrations/` and applied by the custom runner in `src/migrate.ts`. The `events` table is append-only, enforced by a DB trigger. `appendEvent` in `src/runtime.ts` is **the only write path for events**. In one transaction it locks the session row, checks the scenario version pin, handles the idempotency key, loads the snapshot, calls `step`, inserts the event, upserts `session_snapshots`, writes projections (`projections.ts`) and enqueues jobs through graphile-worker's SQL `add_job`. Every job for a session goes on queue `session:<id>`, so a session's jobs run one at a time in order.
- **`packages/prompts`** holds pinned model config per role (`models.ts`) and versioned prompt builders in `roles/`, one per LLM role plus the bot associate. Each builder returns `{ system, user, version }`. Bump the `*_VERSION` constant when you change a prompt, because generations are recorded with that version.
- **`apps/worker`** has the LLM providers in `llm/` (anthropic, bedrock, deterministic mock), job handlers in `jobs/`, a two-layer fact checker in `factcheck/` (rules first, then a model check, with up to two regenerations; after that the email is held for admin release), and the graphile-worker runner. Every LLM call is written to the `generations` table. `telemetry.ts` also sends generations to Langfuse and errors to Sentry, each only when its keys are set.
- **`packages/evals`** is a bot-associate harness driven by the path files in `src/paths/*.yaml` (strong, weak, mixed, answer-seeker, off-script). It adds automatic checks, an offline judge and Cohen's kappa. Reports go to `packages/evals/runs/` (gitignored).
- **`apps/web`** is a Next.js 15 app covering the inbox, the PD roster, the admin console and the rater view. `next.config.ts` transpiles the workspace packages and aliases `.js` imports to `.ts`. Live updates are SSE backed by 2-second Postgres polling.

### How a send becomes state

1. `POST /api/inbox/send` runs the intent classifier. If the email is a deliverable and there's an open decision point, the API returns `needsRationale` and the at-send sheet collects a rationale before anything is sent.
2. The API calls `appendEvent(email_sent)`. The engine steps and jobs are enqueued.
3. The worker runs the assessor and appends `assessment_recorded`. The engine then completes the assignment, seeds consequences, and plans the Socratic reflection and the next beats. The worker writes each email, fact-checks it, and appends either `message_delivered` or `message_held`.
4. The inbox picks up the new message over SSE.

## Deployment

Staging runs on Railway (services `web` and `worker`, built from `main`) against Neon Postgres; the README's "Deploying" section has the full setup.

- Service config is infrastructure as code in `.railway/railway.ts` (`railway config plan` / `apply`). Secrets are declared with `preserve()` and set with `railway variables`, so values never land in git. Custom domains aren't supported there; use `railway domain`.
- `DATABASE_URL` must be Neon's direct (unpooled) connection string, because graphile-worker relies on LISTEN/NOTIFY.
- The worker applies migrations on start (`RUN_MIGRATIONS_ON_START=1`). Seed a deployed database with `SEED_ADMIN_EMAIL=<you> railway run --service worker pnpm db:seed`, since the `.example` seed users can't receive magic links.
- Postmark sends only the magic sign-in links; the in-game emails live in the app's inbox. WorkOS sign-in only matches users who were already invited.

## Conventions

- ESM throughout. Relative imports use `.js` specifiers that resolve to `.ts` (NodeNext, `verbatimModuleSyntax`, so type-only imports need `import type`). `noUncheckedIndexedAccess` is on.
- Prettier: 100 columns, double quotes, trailing commas.
