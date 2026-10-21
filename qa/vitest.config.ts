import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The full set runs far longer, most of all on Rapier (the 100-seed towers took 23 minutes).
    testTimeout: process.env.QA_FULL === '1' ? 3_600_000 : 600_000,
    hookTimeout: 600_000,
    // Physics suites are CPU-bound and share one WASM instance per file.
    fileParallelism: false,
  },
});
