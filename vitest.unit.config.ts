import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test file patterns for unit tests
    include: ["**/*.test.ts", "**/*.spec.ts"],
    exclude: ["node_modules", "dist", ".wrangler"],

    // Use default node environment (not Cloudflare workers pool)
    environment: "node",

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.spec.ts",
        "node_modules/**",
        "dist/**",
      ],
    },

    // Global test timeout
    testTimeout: 10000,

    // Reporter configuration
    reporters: ["default"],

    // Globals for vitest
    globals: true,
  },
});
