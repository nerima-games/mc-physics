# Migrating to mc-physics 0.4.0

mc-physics 0.4.0 targets Effect 4 and `@nerima-games/mc-kernel` 0.9.0. It changes several public input types and removes runtime exports whose implementation owner is now `mc-sim`.

## Removed explosion and primed TNT execution exports

`planExplosion`, `applyExplosionPlan`, `primeTnt`, `planPrimedTnt`, `applyPrimedTntPlan`, `DEFAULT_TNT_FUSE_SECS`, and `MAX_TNT_FUSE_ADVANCE_SECS` are no longer exported by mc-physics. The `PrimedTntCommit`, `PrimedTntMutation`, `PrimedTntPlan`, `PrimedTntRequest`, and `PrimedTntState` types are also no longer re-exported. The execution owner is [`mc-sim`](https://github.com/nerima-games/mc-sim). This release does not provide a replacement execution entry point; coordinate this breaking change with the corresponding mc-sim update. The shared `ExplosionBlock`, `ExplosionBlockPosition`, `ExplosionBlockReader`, `ExplosionCommit`, `ExplosionEntity`, `ExplosionEntityEffect`, `ExplosionLimits`, `ExplosionMutation`, `ExplosionPlan`, and `ExplosionRequest` types and `DEFAULT_EXPLOSION_LIMITS` remain available from mc-physics and are defined by mc-kernel.

Move explosion and primed TNT execution into the simulation layer. Do not replace these exports with a local implementation in mc-physics.

## Kernel 0.9 brands and validation

Public quantities and identifiers now use the corresponding mc-kernel brands where one exists, including `PositionAxis`, `BlockAxis`, `BlockId`, `EntityId`, `AngleRadians`, `DeltaTimeSecs`, `MonotonicTimeSecs`, `FixedDurationSecs`, and `BlockContactDamage`. Physics-specific units without a shared kernel brand retain their mc-physics semantic types. Dimensionless coefficients and movement input axes remain plain numbers.

Effect 4 brand constructors validate values. At an untrusted boundary, use `.option(value)` when invalid values should be treated as absent, or `.result(value)` when the caller must handle the validation failure. Direct constructor calls are for values already known to be valid; invalid direct calls throw `BrandError`.

`FootY`, `CentreY`, `HalfHeight`, and `DeltaTimeSecs` are exported brand constructor functions, now typed as Effect 4 `Brand.Constructor`. Call them directly only for values already known to be valid; use `.option(value)` or `.result(value)` to validate values at a boundary.

Registry consumers must handle the new result containers: `blockIdOf` returns an Effect `Option`, while `resolvedBlockOfId`, `isKnownBlockId`, `capabilityOfBlockId`, and `resolveBlockProperties` return Effect `Result` values. Import `Option` and `Result` from Effect 4. Check an option with `Option.isSome` before reading its `.value`; check `Result.isFailure` and handle or propagate `.failure` before reading `.success`.

`CollisionShape` is available through the public kernel root or the `@nerima-games/mc-kernel/domain/block-properties` subpath. Deep imports into kernel implementation files are not package exports.

## Frame delta boundary

Use mc-kernel's `clampFrameDelta` for raw frame deltas. `deltaTimeBetween` accepts monotonic timestamp readings and returns a `Result`; it validates each reading and delegates the interval to mc-kernel's `frameDeltaBetween`. `integrateBody` consumes a `DeltaTimeSecs` for one fixed step and does not apply a frame clamp internally.

## Result-returning physics operations

These public operations now return Effect `Result` values:

- Coordinates and geometry: `centreOfFoot`, `footOfCentre`, `standingPlaneAbove`, `entityAABB`, `blockAABB`, `penetrationY`, and `voxelRaycast`.
- Entity collision: `inverseMassOf`, `collisionOf`, `potentialPairs`, `detectEntityCollisions`, and `resolveEntityCollisions`.
- Environment sampling and motion: `sampleSurfaceEffects`, `sampleBlockHazards`, `sampleFluidEffects`, `applySurfaceMotion`, and `applyFluidMotion`.
- Time, integration, movement, and resolution: `deltaTimeBetween`, `integrateBody`, `integrate` (the body-array form), `maxFallPerStep`, `advanceFallTracking`, `applyMovementInput`, `applyKnockback`, `pistonExtrusion`, `glideStep`, `fallingBlockCandidateAt`, `resolveBody`, `resolveWorld`, `stepBody`, `stepWorld`, and `maxSpeedWithoutTunnelling`.

`glideStep` now returns `Result<VelocityVector, BrandError>`; its previous return type was `Position`. Check each result before reading `.success`, and handle or propagate `.failure` instead of replacing it with `null`, `undefined`, or a default value.

```ts
const result = resolveBody(body, deltaTime, options)
if (Result.isFailure(result)) {
  return Result.fail(result.failure)
}
return consume(result.success)
```

The `BlockAt` and `BlockPropertiesAt` callback types used by the environment and resolver also return `Result`. A callback may return `Result.succeed(null)` for a missing ID or an ID that mc-kernel recognizes as empty; a successful registry lookup that returns `undefined` also means no block. A `BlockId` validation or registry-resolution failure must remain a failure so collision and hazard sampling can stop safely.

## Hazards and movement

`Resolution` now includes `hazards`, sampled once from the post-collision body AABB through the supplied block environment. It contains `contactDamage`, `suffocating`, and `climbable`. Callers still own applying contact damage or other effects.

Movement input includes sneak behavior. Creative-flight transitions are exposed as pure state functions in `creative-flight`; the host owns input event timing and game-state application.

## Projectile ownership

The generic projectile engine remains in mc-physics, with `Projectile`, `ProjectileLaunch`, `ARROW_PROFILE`, `launchProjectile`, and `stepProjectile`.
