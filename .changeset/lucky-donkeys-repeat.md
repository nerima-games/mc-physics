---
"@nerima-games/mc-physics": patch
---

Make the no-type-assertion gate binding, and align the shared tsconfig and the docs with `mc-kernel` (P2 R-C1 / R-C2 / R-C4). No public API change; `test/public-api.test.ts` is untouched and still green.

`.ast-grep/rules/no-type-assertion.yml` moves from `severity: warning` to `severity: error`, so the 19 assertions ast-grep had been reporting without failing the build are now gone: 8 non-null assertions in `src/domain/entity-collision.ts` and `src/domain/entity-collision-resolve.ts`, 11 in the test suite. `as const` stays the only permitted assertion.

- `potentialPairs` reads its spatial-hash buckets through `bucket.entries()`, which yields `[number, number]` instead of `number | undefined`. The dedup key, the `Math.min`/`Math.max` normalisation and the final ordering are unchanged, so the returned pairs are identical for identical input; the inner comparison count inside one bucket goes from n(n-1)/2 to n.
- `detectEntityCollisions` and `resolveEntityCollisions` keep reading `entities[index]` live rather than from a snapshot, because `resolveEntityCollisions` writes back into the array mid-pass and a snapshot would resolve later pairs against stale bodies. `noUncheckedIndexedAccess` types that read as optional, so each site narrows with a guard and carries a `/* v8 ignore */` exemption plus a written reachability proof, the mechanism `vitest.config.ts`'s `thresholds` comment reserves for proven-unreachable points and `domain/dda.ts` already uses.
- Test helpers throw a named error instead of asserting a value into existence. An out-of-range index previously spliced `undefined` into the array under test and produced an unrelated failure.
- One assertion could not be kept. `test/movement.test.ts` passed `Number.NaN as never` to check that `applyMovementInput` sanitises a non-finite `DeltaTimeSecs`. Kernel's `DeltaTimeSecs` is an effect `Brand.Constructor` whose only construction path validates, so an invalid instance is reachable only through a type assertion, which T-3 bans. The delta is now a legal `DeltaTimeSecs(0.05)`; the invalid `MovementInput` and `MovementConfig` fields that test actually exercises are unchanged and its assertion still holds, because `groundAcceleration` is `NaN` and so the maximum change per step is zero whatever the delta is.

`tsconfig.base.json` is now a copy of `mc-kernel`'s: all 46 compiler options are identical, `lib` included, and the only textual differences are comments. One of those comments was wrong here and is corrected — it claimed `tsconfig.build.json` overrides `noEmit` for a declaration-only build, while `tsconfig.release.json` is the only emitting configuration.

Documentation no longer hardcodes a version. `docs/versioning.md` §1 no longer claims `0.1.7` (the package is at `0.2.2`) and its `0.x` bump examples are version-agnostic; `README.md`, `docs/responsibility.md` and `docs/public-api.md` name `mc-kernel` without a stale `@0.5.0` pin. `docs/public-api.md` §5-6 also corrects `mc-redstone` to `mx-redstone`: `nerima-games/mx-redstone` exists and `nerima-games/mc-redstone` does not.
