import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,mjs}"],
    exclude: ["src/**/*.live.test.{ts,mjs}"],
  },
});
