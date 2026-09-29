# @nerima-games/mc-physics

## 0.3.0

### Minor Changes

- [#25](https://github.com/nerima-games/mc-physics/pull/25) [`d42a2fc`](https://github.com/nerima-games/mc-physics/commit/d42a2fc5675a28ec0f1c448a5c477272b096ab21) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate physics time contracts to `mc-kernel` 0.8.0. `FIRST_FRAME_DELTA_SECS` now has the kernel `DeltaTimeSecs` type, while `MIN_DELTA_SECS` and `MAX_DELTA_SECS` are re-exports of the kernel frame-timing constants. Fixed tick timing uses `FixedDurationSecs`, and the compile fixture locks the public brand boundaries.

### Patch Changes

- [#24](https://github.com/nerima-games/mc-physics/pull/24) [`aa1f9d3`](https://github.com/nerima-games/mc-physics/commit/aa1f9d3f9749342517b08228763bdbabba8841b4) Thanks [@takeokunn](https://github.com/takeokunn)! - Make the no-type-assertion gate binding, and align the shared tsconfig and the docs with `mc-kernel` (P2 R-C1 / R-C2 / R-C4). No public API change; `test/public-api.test.ts` is untouched and still green.

  `.ast-grep/rules/no-type-assertion.yml` moves from `severity: warning` to `severity: error`, so the 19 assertions ast-grep had been reporting without failing the build are now gone: 8 non-null assertions in `src/domain/entity-collision.ts` and `src/domain/entity-collision-resolve.ts`, 11 in the test suite. `as const` stays the only permitted assertion.

  - `potentialPairs` now emits a pair as each entity registers into a spatial-hash cell, pairing it with the entities already in that cell, instead of walking every bucket afterwards. Each unordered pair is still produced exactly once, the dedup key, the min/max normalisation and the final ordering are untouched, and the pairs returned are identical for identical input. The bucket index is never read back at all, so no assertion is needed and no comparison is added: a bucket of n still costs n(n-1)/2 pair constructions.
  - `detectEntityCollisions` and `resolveEntityCollisions` keep reading `entities[index]` live rather than from a snapshot, because `resolveEntityCollisions` writes resolved bodies back into that array partway through a pass and a snapshot would resolve the later pairs of one iteration against stale bodies. `noUncheckedIndexedAccess` types that read as optional, so each site narrows with a guard, and the two sites differ in what that guard is worth. `entities` is the caller's array, so `detectEntityCollisions`' guard is live: a hole, or an accessor that answers once and then stops, leaves the index unreadable, and such a pair is skipped rather than resolved against a missing entity. That is now a test. `resolveEntityCollisions` works on its own dense copy taken once, so its index is always in range; that site keeps a `/* v8 ignore */` exemption with the reachability proof written out, and a second test pins the copy-once contract the proof depends on.
  - Test helpers throw a named error instead of asserting a value into existence. An out-of-range index previously spliced `undefined` into the array under test and surfaced as an unrelated failure.
  - `test/movement.test.ts` no longer passes `Number.NaN as never`. Kernel's `DeltaTimeSecs` is an effect `Brand.Constructor` whose only construction path validates, so an invalid instance is reachable only through a type assertion, which T-3 bans. The test now runs the same invalid-control case across several legal deltas, which is the contract that survives: the controls are sanitised, and the delta's own rejection is covered separately in `test/delta-time.test.ts`.
  - `test/integrate.test.ts`'s `@ts-expect-error` is a deliberate compile-time negative control for the foot-Y/centre-Y brand separation. Its comment now says so, and notes that an unused-directive error is what catches the brands becoming interchangeable.

  `tsconfig.base.json` is now a copy of `mc-kernel`'s: all 46 compiler options are identical, `lib` included, and the only textual differences are comments. One of those comments was wrong here and is corrected, it claimed `tsconfig.build.json` overrides `noEmit` for a declaration-only build while `tsconfig.release.json` is the only emitting configuration.

  No document states a version now. `docs/versioning.md` §1 no longer claims `0.1.7` (the package is at `0.2.2`) and its `0.x` bump examples are version-agnostic; `README.md`, `docs/architecture.md`, `docs/responsibility.md`, `docs/porting.md` and `docs/public-api.md` name `mc-kernel` without a hardcoded `@0.5.0`. The piston ownership boundary is attributed to `mx-redstone` everywhere it appeared, in `README.md`, `docs/public-api.md` and the `src/domain/piston.ts` header: `nerima-games/mx-redstone` exists and `nerima-games/mc-redstone` does not.

## 0.2.2

### Patch Changes

- [#14](https://github.com/nerima-games/mc-physics/pull/14) [`f1ac1b2`](https://github.com/nerima-games/mc-physics/commit/f1ac1b2098cdc402a7bb76d41df7f9791b7a4578) Thanks [@takeokunn](https://github.com/takeokunn)! - Bump the `@nerima-games/mc-kernel` pin from 0.5.0 to 0.7.0 (exact). The two releases in between only added a `blastResistance` property column and fixed unrelated drop-table rows; the block registry's `collisionShape` assignments and every export this package consumes (`Position`, `DeltaTimeSecs`, `CollisionShape`, `BlockProperties`, `BlockCapabilities`, `FluidKind`, `resolveBlockProperties`, `isEmpty`, `resolvedBlockOfId`, `blockIdOf`, `blockPosition`) are unchanged, so this is a pure pin alignment with no source changes.

- [#13](https://github.com/nerima-games/mc-physics/pull/13) [`7221fa8`](https://github.com/nerima-games/mc-physics/commit/7221fa87d9df96d1c7047971937a1419c952f19d) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.2.1

### Patch Changes

- [#11](https://github.com/nerima-games/mc-physics/pull/11) [`27112e0`](https://github.com/nerima-games/mc-physics/commit/27112e01a25a2424af3d282f1240f207e538baeb) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added

## 0.2.0

### Minor Changes

- [`239e3de`](https://github.com/nerima-games/mc-physics/commit/239e3deebd5c4689600d80ced3b25718d5779d1d) Thanks [@takeokunn](https://github.com/takeokunn)! - Move onto `@nerima-games/mc-kernel@0.5.0` and adopt its shared vocabulary and physics planners. This is a
  breaking change to the public API, released as `minor` per this package's `0.x` versioning policy
  (`docs/versioning.md` §5: a MAJOR-classified change is a minor bump while the interface is unstable).
  
  Breaking changes:
  
  - The local `{ x, y, z }` position type and its lowercase constructor are retired; `coordinates.ts`
    re-exports mc-kernel's `Position`/`position` instead. The shape is unchanged, so only the import name
    moves. The flat `AABB` type used by this package's collision hot path is unaffected.
  - The Arrow-specific projectile API (its dedicated launch/step functions and per-arrow constants) is
    removed. `launchProjectile`/`stepProjectile` now take an injected `ProjectileProfile`, with
    `ARROW_PROFILE` / `SNOWBALL_PROFILE` / `EGG_PROFILE` / `TRIDENT_PROFILE` as presets.
    `ARROW_PROFILE` reproduces the kernel arrow implementation step-for-step (asserted in
    `test/projectile.test.ts`). Callers that need the concrete `Arrow` type, persistence, item consumption, or
    damage still go to mc-kernel directly.
  - `applyMovementInput` gains a required `inFluid` argument (between `isGrounded` and `deltaTime`) to drive
    swim-up acceleration; existing call sites must be updated to pass it.
  - The bounded explosion planner and primed-TNT fuse projection are no longer this package's own
    implementation. The former `domain/explosion.ts` and `domain/primed-tnt.ts` are deleted; `src/index.ts`
    re-exports mc-kernel's `planExplosion`/`applyExplosionPlan`/`primeTnt`/`planPrimedTnt`/`applyPrimedTntPlan`
    directly, after confirming the two implementations agreed on input/output before deleting the duplicate
    (`docs/porting.md` §7). The caller-facing contract — bounded computation, a commit callback receiving the
    plan, no world or entity state owned here — is unchanged.
  - `FULL_BLOCK_SHAPE`, `SLAB_SHAPE`, `PRESSURE_PLATE_SHAPE`, `CACTUS_SHAPE`, and `COLLISION_SHAPE_AABBS` move
    from `coordinates.ts` to a new `shape-data.ts` module (data/logic separation); all remain re-exported from
    the package root, so only a direct deep import of the old file path would break.
  - `dda.ts` is split into the grid walk (`dda.ts`) and shape narrow-phase (`dda-shapes.ts`); `entity-collision.ts`
    is split into detection (`entity-collision.ts`) and mass-based resolution (`entity-collision-resolve.ts`).
    Both halves stay re-exported from the package root. Broad-phase and narrow-phase primitives
    (`potentialPairs`, `collisionOf`, `inverseMassOf`, `normalizedOptions`) that used to be internal are now
    public.
  - `integrateBody`/`integrate`/`stepBody`/`stepWorld` drop their trailing positional `gravityY`,
    `dragPerSecond`, and `terminalVelocityY` arguments in favour of a single final `IntegrationOptions`
    parameter (`Readonly<{ gravityY?: number; dragPerSecond?: number; terminalVelocityY?: number }>`).
    Existing call sites passing those as positional arguments must switch to an options object.
    `dragPerSecond` outside `[0, 1]` or non-finite now falls back to the existing default of 1 (no drag);
    `terminalVelocityY`'s fallback rule is unchanged.
  - The `GLIDE_*` calibration constants are no longer re-exported from the package root. `glideStep`,
    `DEFAULT_GLIDE_CONFIG`, and the `GlideConfig`/`GlideSight` types remain public; only the individual tuning
    scalars that feed `DEFAULT_GLIDE_CONFIG` were dropped from the barrel.
  
  New features, all opt-in via injection with defaults matching vanilla Java behaviour:
  
  - `integrateBody`/`stepBody` accept `dragPerSecond` (continuous air drag, default 1 = none) and
    `terminalVelocityY` (overridable downward speed cap, default unchanged) so a caller can express a
    slow-falling body without changing the module defaults.
  - `SurfaceEffects.movementDragY` and `FluidMotionCoefficients.{water,lava}.dragPerSecondY` add a vertical
    drag independent of the existing horizontal one, for materials like cobwebs, powder snow, and lava whose
    vertical resistance differs from horizontal.
  - `ResolveOptions.bouncinessAt` adds slime-block/bed-style landing bounce, sampled only on a genuine downward
    floor impact; a bounced landing reports `isGrounded: false`.
  - `normalizedOptions` (`entity-collision.ts`) now floors `cellSize` and caps `iterations`, so an extreme or
    hostile `EntityCollisionOptions` can no longer drive broad-phase bucketing or resolver passes toward
    unbounded work.
  - A new `domain/glide.ts` computes one elytra glide tick of velocity change (`glideStep`). The module header
    documents that its constants are this repository's own calibration toward the documented shape of vanilla
    elytra flight, sourced from community reverse-engineering rather than checked Mojang source.
  - A new `domain/piston.ts` computes the displacement a moving piston-arm block imposes on a stationary
    entity (`pistonExtrusion`) — the one function in this package that establishes non-embedding instead of
    merely maintaining it (`docs/design-notes.md` P-9-7).
  
  Tooling: `typescript` is pinned to `7.0.2` (dropping the previous TS 6 preview alias), `@types/node` moves to
  `^26.4.0`, and every CI step now has its own `timeout-minutes` so a hang is localized to the step that stalled
  instead of consuming the whole job budget.

- [`536cc7f`](https://github.com/nerima-games/mc-physics/commit/536cc7ff234fffe6ab8beae2c767644109b171af) Thanks [@takeokunn](https://github.com/takeokunn)! - Use mc-kernel's `BlockProperties` and `DeltaTimeSecs` directly, split collision resolution into focused modules, and publish ESM JavaScript with declaration files from `dist/`. The world query now resolves block IDs and states before passing properties to the physics layer; optional state-specific shapes remain authoritative when supplied.
  
  Add a bounded, deterministic explosion planner that reports block mutations and entity effects without owning world or entity state.
  
  Move the pure primed-TNT fuse and detonation projection into this package, reusing the explosion planner without owning world or entity state.

### Patch Changes

- [#9](https://github.com/nerima-games/mc-physics/pull/9) [`dac24e1`](https://github.com/nerima-games/mc-physics/commit/dac24e1f2d20b9578d15528ef95e79369b56d9c8) Thanks [@takeokunn](https://github.com/takeokunn)! - Bring `src/**` fully into compliance with the org's newly-effective oxlint strictness (`.oxlintrc.json` scoped-strictness policy): every `src/domain/*.ts` file is now clean under `oxlint --deny-warnings` with zero disable comments, via real fixes (named constants for magic numbers, if/else in place of ternaries, sorted object keys and imports, `continue`-free loops) plus a small set of documented, evidence-based rule-threshold adjustments for this package's scalarized hot-path geometry functions (`max-params`, `max-statements`, `complexity`, `init-declarations`) and its coordinate/geometry vocabulary (`id-length`, `new-cap`). `test/**` gets a matching `overrides` block relaxing the same pure-style rules for test-fixture patterns.
  
  Fixes a real bug found while converting `resolve.ts`'s `shapeAt` from a ternary to an if/else: the original used `??`, which treats a `blockShapeAt` callback returning `null` the same as it being absent (both fall through to `isBlockSolid`); a naive conversion would have treated an explicit `null` as a final answer instead. The corrected version preserves the original fallthrough behaviour and is covered by the existing `solidity is injected` test suite.
  
  Closes the four-v8-metric coverage gate (99% statements/branches/functions/lines) opened up by this lint work and by pre-existing gaps in `projectile.ts`: added behavioural tests for the raycast's step-budget exhaustion, the resolver's X-vs-Z sweep tie-break, and `projectile.ts`'s axis-parallel segment test, entering-face normals (both signs), multi-candidate nearest-hit selection, non-flying-arrow no-op, and step-displacement overflow. The few still-uncovered lines are `/* v8 ignore */`d with a written reachability proof at each site (not a blanket exemption), matching the pattern this file already used for `intersectShape`.

- [`424ffc5`](https://github.com/nerima-games/mc-physics/commit/424ffc580fb54c8c84def7411d83b3cbd44a3e37) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate repository layout and tooling onto the nerima-games org standard: move shipped source under `src/`, remove the `api-lock.md`/`scripts/api-lock.ts` snapshot mechanism and `scripts/check-dependency-whitelist.ts` in favour of a `.oxlintrc.json` `no-restricted-imports` rule, SHA-pin third-party GitHub Actions, add Dependabot, enable the 99% coverage gate, and adopt changesets for versioning. No public API change: `src/index.ts` re-exports the same surface as the previous `index.ts`.
