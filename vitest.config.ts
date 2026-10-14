import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // server-only throws outside a React Server Components build; tests run plain Node.
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // The workflow test shares one database, so test files run one at a time.
    fileParallelism: false,
  },
});
