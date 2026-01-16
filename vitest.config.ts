import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    // Test file patterns
    include: ["**/*.test.ts", "**/*.spec.ts"],
    exclude: ["node_modules", "dist", ".wrangler"],

    // Use Cloudflare Workers pool (miniflare)
    pool: "@cloudflare/vitest-pool-workers",
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.toml",
        },
        miniflare: {
          // Enable bindings for testing
          compatibilityDate: "2026-01-11",
          compatibilityFlags: ["nodejs_compat"],
          // D1 database for testing (in-memory)
          d1Databases: ["DB"],
          // R2 bucket for testing
          r2Buckets: ["BLOBS"],
          // KV namespace for testing
          kvNamespaces: ["KV"],
          // Queue bindings for testing
          queueProducers: {
            FANOUT_QUEUE: "events-fanout-test",
          },
        },
      },
    },

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
  },
});
