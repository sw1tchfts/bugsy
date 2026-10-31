import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

// Two projects: unit tests run anywhere; rls tests need DATABASE_URL (see docs/dev-setup.md).
export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts", "lib/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "rls",
          environment: "node",
          include: ["tests/rls/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
          setupFiles: ["tests/load-env.ts"],
        },
      },
    ],
  },
});
