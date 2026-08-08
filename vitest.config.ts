import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: '50%',
        minForks: 1,
        isolate: true,
        singleFork: false,
      },
    },
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**'],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    slowTestThreshold: 300,
    fileParallelism: true,
    sequence: {
      seed: 0,
      hooks: 'stack',
    },
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/index.ts', 'src/domain/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.config.ts', '**/*.test.ts', '**/*.spec.ts'],
      all: true,
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Org-wide gate (TEST_STANDARD.md §3): 99% on all four v8 metrics,
      // enabled immediately and unconditionally, no staged rollout. All four
      // metrics clear 99%; the remaining uncovered points are documented
      // `/* v8 ignore */` lines with a written reachability proof at each
      // site (not a blanket exemption) — currently one in
      // src/domain/dda.ts (the raycast step loop's post-loop fallback) and
      // two in src/domain/projectile.ts (the segment test's final
      // fraction-range check, and the entity-hit `entityId` fallback), each
      // proven unreachable from the algorithm's own invariants rather than
      // merely hard to exercise. See each site's comment for the proof.
      thresholds: { branches: 99, functions: 99, lines: 99, statements: 99 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})
