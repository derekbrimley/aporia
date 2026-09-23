import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "packages/engine/**/*.test.ts",
            "packages/scenario/**/*.test.ts",
            "packages/prompts/**/*.test.ts",
            "apps/worker/**/*.test.ts",
            "packages/evals/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**", "**/*.db.test.ts"],
        },
      },
      {
        test: {
          name: "db",
          include: ["packages/db/**/*.test.ts", "**/*.db.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
