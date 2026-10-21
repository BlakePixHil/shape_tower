import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // Physics suites are CPU-bound and share one WASM instance per file.
    fileParallelism: false,
  },
});
