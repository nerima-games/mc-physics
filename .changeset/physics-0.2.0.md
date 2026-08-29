---
"@nerima-games/mc-physics": minor
---

Move onto `@nerima-games/mc-kernel@0.5.0` and adopt its shared vocabulary and physics planners. This is a
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

New features, all opt-in via injection with defaults matching vanilla Java behaviour:

- `integrateBody`/`stepBody` accept `dragPerSecond` (continuous air drag, default 1 = none) and
  `terminalVelocityY` (overridable downward speed cap, default unchanged) so a caller can express a
  slow-falling body without changing the module defaults.
- `SurfaceEffects.movementDragY` and `FluidMotionCoefficients.{water,lava}.dragPerSecondY` add a vertical
  drag independent of the existing horizontal one, for materials like cobwebs, powder snow, and lava whose
  vertical resistance differs from horizontal.
- `ResolveOptions.bouncinessAt` adds slime-block/bed-style landing bounce, sampled only on a genuine downward
  floor impact; a bounced landing reports `isGrounded: false`.
- A new `domain/glide.ts` computes one elytra glide tick of velocity change (`glideStep`). The module header
  documents that its constants are this repository's own calibration toward the documented shape of vanilla
  elytra flight, sourced from community reverse-engineering rather than checked Mojang source.
- A new `domain/piston.ts` computes the displacement a moving piston-arm block imposes on a stationary
  entity (`pistonExtrusion`) — the one function in this package that establishes non-embedding instead of
  merely maintaining it (`docs/design-notes.md` P-9-7).

Tooling: `typescript` is pinned to `7.0.2` (dropping the previous TS 6 preview alias), `@types/node` moves to
`^26.4.0`, and every CI step now has its own `timeout-minutes` so a hang is localized to the step that stalled
instead of consuming the whole job budget.
