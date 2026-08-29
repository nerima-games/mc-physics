import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    maxWorkers: '50%',
    isolate: true,
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
      exclude: [
        '**/*.d.ts',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        'src/domain/environment-types.ts',
        'src/domain/resolve-types.ts',
      ],
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Organization-wide test standard §3: 100% on all four v8 metrics,
      // enabled immediately and unconditionally, no staged rollout. All four
      // executable metrics must clear 100%; the excluded sources are the two
      // type-only modules, which emit no runtime code. The remaining
      // unreachable points are documented `/* v8 ignore */` lines with a
      // written reachability proof at each site (not a blanket exemption) —
      // currently in src/domain/dda.ts (the raycast step loop's post-loop
      // fallback), proven unreachable from the algorithm's own invariants
      // rather than merely hard to exercise. See that site's comment for the
      // proof.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})
