import { afterAll, describe, expect, it } from "vitest";
import { MockProvider, type LlmProvider } from "@rematter/worker";
import { runPlaythrough, shutdown } from "../run.js";

/**
 * A real model fails now and then (rate limits, overloads). graphile-worker retries the job a few
 * seconds later; the bot has to wait for that retry instead of burning through its rounds and
 * reporting the session stuck.
 */
describe("playthrough with a failing model call", () => {
  afterAll(async () => {
    await shutdown();
  });

  it("waits for the retry and still reaches closing", async () => {
    const mock = new MockProvider();
    let failed = false;
    const flaky: LlmProvider = {
      name: mock.name,
      generateText: async (req) => {
        if (!failed && req.role === "character_writer" && JSON.stringify(req).includes("comparing")) {
          failed = true;
          throw new Error("overloaded_error (simulated)");
        }
        return mock.generateText(req);
      },
      generateJson: (req, schema) => mock.generateJson(req, schema),
    };
    const report = await runPlaythrough({ pathName: "strong", seed: 5, provider: flaky, quiet: true });
    expect(failed).toBe(true);
    expect(report.stuck).toBe(false);
    expect(report.status).toBe("completed");
  }, 120_000);
});
