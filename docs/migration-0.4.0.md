# Migrating to mc-physics 0.4.0

mc-physics 0.4.0 targets Effect 4 and `@nerima-games/mc-kernel` 0.9.0. It changes several public input types and removes runtime exports whose implementation owner is now `mc-sim`.

## Removed explosion and primed TNT execution exports

`planExplosion`, `applyExplosionPlan`, and the primed TNT planning and commit functions are no longer exported by mc-physics. The execution owner is [`mc-sim`](https://github.com/nerima-games/mc-sim). This release does not provide a replacement execution entry point; coordinate this breaking change with the corresponding mc-sim update. The shared explosion data types and `DEFAULT_EXPLOSION_LIMITS` remain available from mc-physics and are defined by mc-kernel.

Move explosion and primed TNT execution into the simulation layer. Do not replace these exports with a local implementation in mc-physics.

## Kernel 0.9 brands and validation

Public quantities and identifiers now use the corresponding mc-kernel brands where one exists, including `PositionAxis`, `BlockAxis`, `BlockId`, `EntityId`, `AngleRadians`, `DeltaTimeSecs`, `MonotonicTimeSecs`, `FixedDurationSecs`, and `BlockContactDamage`. Physics-specific units without a shared kernel brand retain their mc-physics semantic types. Dimensionless coefficients and movement input axes remain plain numbers.

Effect 4 brand constructors validate values. At an untrusted boundary, use `.option(value)` when invalid values should be treated as absent, or `.result(value)` when the caller must handle the validation failure. Direct constructor calls are for values already known to be valid; invalid direct calls throw `BrandError`.

Registry consumers must handle the new result containers: `blockIdOf` returns an Effect `Option`, while `resolvedBlockOfId`, `isKnownBlockId`, `capabilityOfBlockId`, and `resolveBlockProperties` return Effect `Result` values. Import `Option` and `Result` from Effect 4 and branch on those values before using the success payload.

`CollisionShape` is available through the public kernel root or the `@nerima-games/mc-kernel/domain/block-properties` subpath. Deep imports into kernel implementation files are not package exports.

## Frame delta boundary

Use mc-kernel's `clampFrameDelta` for raw frame deltas. `deltaTimeBetween` accepts monotonic timestamp readings and returns a `Result`; it validates each reading and delegates the interval to mc-kernel's `frameDeltaBetween`. `integrateBody` consumes a `DeltaTimeSecs` for one fixed step and does not apply a frame clamp internally.

## Hazards and movement

`Resolution` now includes `hazards`, sampled once from the post-collision body AABB through the supplied block environment. Callers still own applying contact damage or other effects.

Movement input includes sneak behavior. Creative-flight transitions are exposed as pure state functions in `creative-flight`; the host owns input event timing and game-state application.

## Projectile ownership

The generic projectile engine remains in mc-physics, with `Projectile`, `ProjectileLaunch`, `ARROW_PROFILE`, `launchProjectile`, and `stepProjectile`. Tests now pin this package's profile and trajectory contracts instead of comparing against a duplicate kernel implementation.
