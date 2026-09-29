/**
 * Railway infrastructure for the staging deploy. Preview with `railway config plan`,
 * apply with `railway config apply`. Secrets are declared with preserve() so their
 * values stay out of git; set them with `railway variables --service <name> --set`.
 */
import { defineRailway, github, preserve, project, service } from "railway/iac";

const source = github("derekbrimley/aporia", { branch: "main" });
const region = { "us-east4-eqdc4a": 1 }; // US East (Virginia), next to Neon's us-east-1

const shared = {
  APORIA_ENV: "staging",
  LLM_PROVIDER: "anthropic",
  DATABASE_URL: preserve(),
  ANTHROPIC_API_KEY: preserve(),
  SENTRY_DSN: preserve(),
};

export default defineRailway(() => {
  const web = service("web", {
    source,
    rootDirectory: "/",
    regions: region,
    build: "pnpm scenario:build-docs && pnpm --filter @aporia/web build",
    start: "pnpm --filter @aporia/web start",
    healthcheck: "/sign-in",
    healthcheckTimeout: 120,
    deploy: { restartPolicyMaxRetries: 5 }, // restart policy ON_FAILURE is Railway's default
    env: {
      ...shared,
      APP_URL: "https://staging.associatereps.com",
      EMAIL_FROM: "no-reply@associatereps.com",
      AUTH_SECRET: preserve(),
      POSTMARK_SERVER_TOKEN: preserve(),
      WORKOS_API_KEY: preserve(),
      WORKOS_CLIENT_ID: preserve(),
    },
  });
  const worker = service("worker", {
    source,
    rootDirectory: "/",
    regions: region,
    build: "pnpm scenario:build-docs",
    start: "pnpm --filter @aporia/worker start",
    deploy: { restartPolicyType: "ALWAYS" },
    env: {
      ...shared,
      RUN_MIGRATIONS_ON_START: "1",
      LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com",
      LANGFUSE_PUBLIC_KEY: preserve(),
      LANGFUSE_SECRET_KEY: preserve(),
    },
  });
  return project("amused-spirit", { resources: [web, worker] });
});
