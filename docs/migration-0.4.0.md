# Migrating to mc-physics 0.4.0

mc-physics 0.4.0 targets Effect 4 and `@nerima-games/mc-kernel` 0.9.0. It adds branded units and identifiers at public boundaries, propagates validation failures as Effect `Result`, and moves explosion and primed-TNT execution out of this package.

## Creating branded inputs and handling results

Create each branded number or string with the matching constructor’s `.result(value)` method. The tables name each constructor and its owning package. The method validates the raw value and returns a `Result`; inspect the failure before using the success value. For `BlockVector` and `VelocityVector`, use `blockVectorResult(x, y, z)` and `velocityVectorResult(x, y, z)`. `DamageAmount` is a schema-branded kernel type and is validated through `DamageAmountSchema` rather than a brand constructor.

In the field-change table, `∅` means that field was absent in that release.

```ts
const speed = BlocksPerSecond.result(rawSpeed)
if (Result.isFailure(speed)) return Result.fail(speed.failure)
return applyMovementInput(body, input, grounded, inFluid, deltaTime, {
  ...config,
  walkSpeed: speed.success,
})
```

When a physics operation returns `Result`, handle or propagate its failure before reading `.success`. `Option` remains distinct: check `Option.isSome` before reading `.value`. Do not translate a validation or registry failure into `null`, `undefined`, an empty collection, or a default value.

Defaults on optional integration and surface/fluid drag fields apply only when the field is omitted. Explicit `null` and invalid supplied values return a failure instead of selecting the default.

## Machine-generated API comparison: published 0.3.0 → 0.4.0

Compared the published 0.3.0 and head package distributions through their dist/index.d.ts entry points. The TypeScript checker resolved all exports with zero semantic diagnostics for both packages. The comparison found 148 base exports and 156 head exports (13 removed and 21 added). It reports 46 function and callback parameter entries, 34 return changes, and 92 exported type field changes (88 type changes, 4 additions, 0 removals, and 0 optionality changes). Five scalar root-exported constant type changes are listed separately.

### Removed exports (13)

| Export | 0.3.0 | 0.4.0 |
| --- | --- | --- |
| `DEFAULT_TNT_FUSE_SECS` | present | removed |
| `MAX_TNT_FUSE_ADVANCE_SECS` | present | removed |
| `PrimedTntCommit` | present | removed |
| `PrimedTntMutation` | present | removed |
| `PrimedTntPlan` | present | removed |
| `PrimedTntRequest` | present | removed |
| `PrimedTntState` | present | removed |
| `applyExplosionPlan` | present | removed |
| `applyPrimedTntPlan` | present | removed |
| `clampDeltaTime` | present | removed |
| `planExplosion` | present | removed |
| `planPrimedTnt` | present | removed |
| `primeTnt` | present | removed |

### Function and callback parameter changes (46 parameter entries)

| Export | 0.3.0 parameter types | 0.4.0 parameter types | Create branded inputs with |
| --- | --- | --- | --- |
| `BlockAt` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `BlockIdAt` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `BlockPropertiesAt` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `BlockShapeAt` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `EnvironmentBlockShapeAt` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `FluidStateAt` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `HasGroundSupport` | `positionX: number; positionZ: number` | `positionX: PositionAxis; positionZ: PositionAxis` | `PositionAxis.result(value)` (mc-kernel) |
| `IsTargetable` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `RaycastShapeAt` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `applyKnockback` | `impulse: Position` | `impulse: VelocityVector` | `velocityVectorResult(x, y, z)` (mc-physics) |
| `blockAABB` | `bx: number; by: number; bz: number` | `bx: BlockAxis; by: BlockAxis; bz: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `entityAABB` | `x: number; z: number; halfWidth: number` | `x: PositionAxis; z: PositionAxis; halfWidth: BlockLength` | `BlockLength.result(value)` (mc-physics); `PositionAxis.result(value)` (mc-kernel) |
| `glideStep` | `velocity: Position` | `velocity: VelocityVector` | `velocityVectorResult(x, y, z)` (mc-physics) |
| `isClampedDelta` | `deltaSecs: number` | `deltaSecs: DeltaTimeSecs` | `DeltaTimeSecs.result(value)` (mc-kernel) |
| `maxFallPerStep` | `maxDeltaSecs: number` | `maxDeltaSecs: DeltaTimeSecs` | `DeltaTimeSecs.result(value)` (mc-kernel) |
| `maxSpeedWithoutTunnelling` | `halfExtent: number; blockThickness: number; maxDeltaSecs: number` | `halfExtent: BlockLength; blockThickness: BlockLength; maxDeltaSecs: DeltaTimeSecs` | `BlockLength.result(value)` (mc-physics); `DeltaTimeSecs.result(value)` (mc-kernel) |
| `position` | `coordinateX: number; coordinateY: number; coordinateZ: number` | `coordinateX: PositionAxis; coordinateY: PositionAxis; coordinateZ: PositionAxis` | `PositionAxis.result(value)` (mc-kernel) |
| `potentialPairs` | `cellSize: number` | `cellSize: BlockLength` | `BlockLength.result(value)` (mc-physics) |
| `standingPlaneAbove` | `surfaceY: number` | `surfaceY: BlockAxis` | `BlockAxis.result(value)` (mc-kernel) |
| `stepProjectile` | `dt: number` | `dt: DeltaTimeSecs` | `DeltaTimeSecs.result(value)` (mc-kernel) |
| `voxelRaycast` | `maxDistance: number` | `maxDistance: BlockLength` | `BlockLength.result(value)` (mc-physics) |

### Function return changes (34)

| Export | 0.3.0 return type | 0.4.0 return type | Brand constructors appearing in the new type |
| --- | --- | --- | --- |
| `BlockAt` | `BlockSample \| null` | `Result.Result<BlockSample \| null, BlockLookupError>` | — |
| `BlockPropertiesAt` | `BlockProperties \| null` | `Result.Result<BlockProperties \| null, BlockLookupError>` | — |
| `advanceFallTracking` | `FallTrackingTransition` | `Result.Result<FallTrackingTransition, Brand.BrandError>` | — |
| `applyFluidMotion` | `Body` | `Result.Result<Body, Brand.BrandError>` | — |
| `applyKnockback` | `Body` | `Result.Result<Body, Brand.BrandError>` | — |
| `applyMovementInput` | `Body` | `Result.Result<Body, Brand.BrandError>` | — |
| `applySurfaceMotion` | `Body` | `Result.Result<Body, Brand.BrandError \| RangeError>` | — |
| `blockAABB` | `AABB` | `Result.Result<AABB, Brand.BrandError \| RangeError>` | — |
| `centreOfFoot` | `CentreY` | `Result.Result<CentreY, Brand.BrandError>` | `CentreY.result(value)` (mc-physics) |
| `collisionOf` | `EntityCollision \| null` | `Result.Result<EntityCollision \| null, Brand.BrandError \| RangeError>` | — |
| `deltaTimeBetween` | `DeltaTimeSecs` | `Result.Result<DeltaTimeSecs, Brand.BrandError>` | `DeltaTimeSecs.result(value)` (mc-kernel) |
| `detectEntityCollisions` | `ReadonlyArray<EntityCollision>` | `Result.Result<ReadonlyArray<EntityCollision>, Brand.BrandError \| RangeError>` | — |
| `entityAABB` | `AABB` | `Result.Result<AABB, Brand.BrandError \| RangeError>` | — |
| `fallingBlockCandidateAt` | `FallingBlockCandidate \| null` | `Result.Result<FallingBlockCandidate \| null, FallingBlockCandidateError>` | — |
| `footOfCentre` | `FootY` | `Result.Result<FootY, Brand.BrandError>` | `FootY.result(value)` (mc-physics) |
| `glideStep` | `Position` | `Result.Result<VelocityVector, Brand.BrandError>` | `velocityVectorResult(x, y, z)` (mc-physics) |
| `integrate` | `ReadonlyArray<Body>` | `Result.Result<ReadonlyArray<Body>, Brand.BrandError \| RangeError>` | — |
| `integrateBody` | `Body` | `Result.Result<Body, Brand.BrandError \| RangeError>` | — |
| `inverseMassOf` | `number` | `Result.Result<InverseMass, Brand.BrandError>` | `InverseMass.result(value)` (mc-physics) |
| `maxFallPerStep` | `number` | `Result.Result<BlockLength, Brand.BrandError>` | `BlockLength.result(value)` (mc-physics) |
| `maxSpeedWithoutTunnelling` | `number` | `Result.Result<BlocksPerSecond, Brand.BrandError>` | `BlocksPerSecond.result(value)` (mc-physics) |
| `penetrationY` | `number` | `Result.Result<BlockLength, Brand.BrandError \| RangeError>` | `BlockLength.result(value)` (mc-physics) |
| `pistonExtrusion` | `PistonExtrusion` | `Result.Result<PistonExtrusion, Brand.BrandError>` | — |
| `potentialPairs` | `ReadonlyArray<readonly [number, number]>` | `Result.Result<ReadonlyArray<readonly [number, number]>, Brand.BrandError \| RangeError>` | — |
| `resolveBody` | `Resolution` | `Result.Result<Resolution, ResolveError>` | — |
| `resolveEntityCollisions` | `EntityCollisionResolution` | `Result.Result<EntityCollisionResolution, Brand.BrandError \| RangeError>` | — |
| `resolveWorld` | `ReadonlyArray<Resolution>` | `Result.Result<ReadonlyArray<Resolution>, ResolveError>` | — |
| `sampleBlockHazards` | `BlockHazards` | `Result.Result<BlockHazards, EnvironmentError>` | — |
| `sampleFluidEffects` | `FluidEffects` | `Result.Result<FluidEffects, EnvironmentError>` | — |
| `sampleSurfaceEffects` | `SurfaceEffects` | `Result.Result<SurfaceEffects, EnvironmentError>` | — |
| `standingPlaneAbove` | `FootY` | `Result.Result<FootY, Brand.BrandError>` | `FootY.result(value)` (mc-physics) |
| `stepBody` | `Resolution` | `Result.Result<Resolution, ResolveError>` | — |
| `stepWorld` | `ReadonlyArray<Resolution>` | `Result.Result<ReadonlyArray<Resolution>, ResolveError>` | — |
| `voxelRaycast` | `Option.Option<VoxelHit>` | `Result.Result<Option.Option<VoxelHit>, Brand.BrandError \| RangeError>` | — |

### Root-exported constant type changes (5)

| Constant | 0.3.0 type | 0.4.0 type | Create the branded value with |
| --- | --- | --- | --- |
| `CONTACT_EPSILON` | `1e-9` | `BlockLength` | `BlockLength.result(value)` (mc-physics) |
| `GRAVITY_Y` | `-9.82` | `BlocksPerSecondSquared` | `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `MIN_CELL_SIZE` | `0.25` | `BlockLength` | `BlockLength.result(value)` (mc-physics) |
| `PLAYER_HALF_WIDTH` | `0.3` | `BlockLength` | `BlockLength.result(value)` (mc-physics) |
| `TERMINAL_VELOCITY_Y` | `-32` | `BlocksPerSecond` | `BlocksPerSecond.result(value)` (mc-physics) |

### Exported interface/type field changes (92: 88 type changes, 4 additions, 0 removals, 0 optionality changes)

| Exported type | Changed field | 0.3.0 field | 0.4.0 field | Create or adapt the new value with |
| --- | --- | --- | --- | --- |
| `AABB` | `maxX` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `AABB` | `maxY` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `AABB` | `maxZ` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `AABB` | `minX` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `AABB` | `minY` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `AABB` | `minZ` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `BlockHazards` | `contactDamage` | `number (required)` | `BlockContactDamage (required)` | `BlockContactDamage.result(value)` (mc-kernel) |
| `Body` | `vx` | `number (required)` | `BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `Body` | `vy` | `number (required)` | `BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `Body` | `vz` | `number (required)` | `BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `Body` | `x` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `Body` | `z` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `EntityCollider` | `halfWidth` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `EntityCollider` | `id` | `string (required)` | `EntityIdValue (required)` | `EntityId.result(value)` (mc-kernel) |
| `EntityCollider` | `mass` | `number (required)` | `MassValue \| 0 (required)` | `Mass.result(value)` (mc-physics); pass zero as the literal `0` |
| `EntityCollision` | `firstId` | `string (required)` | `EntityIdValue (required)` | `EntityId.result(value)` (mc-kernel) |
| `EntityCollision` | `penetration` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `EntityCollision` | `secondId` | `string (required)` | `EntityIdValue (required)` | `EntityId.result(value)` (mc-kernel) |
| `EntityCollisionOptions` | `cellSize` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `ExplosionBlock` | `resistance` | `number (required)` | `BlockBlastResistance (required)` | `BlockBlastResistance.result(value)` (mc-kernel) |
| `ExplosionBlockPosition` | `x` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `ExplosionBlockPosition` | `y` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `ExplosionBlockPosition` | `z` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `ExplosionEntity` | `id` | `string (required)` | `EntityId (required)` | `EntityId.result(value)` (mc-kernel) |
| `ExplosionEntityEffect` | `damage` | `number (required)` | `DamageAmount (required)` | [DamageAmountSchema](#decoding-damageamount); [decode example](#decoding-damageamount) |
| `ExplosionEntityEffect` | `exposure` | `number (required)` | `ExplosionExposure (required)` | `ExplosionExposure.result(value)` (mc-kernel) |
| `ExplosionEntityEffect` | `id` | `string (required)` | `EntityId (required)` | `EntityId.result(value)` (mc-kernel) |
| `ExplosionLimits` | `maxAffectedEntities` | `number (required)` | `ExplosionEntityCount (required)` | `ExplosionEntityCount.result(value)` (mc-kernel) |
| `ExplosionLimits` | `maxRaySteps` | `number (required)` | `ExplosionRayStepCount (required)` | `ExplosionRayStepCount.result(value)` (mc-kernel) |
| `ExplosionLimits` | `maxVisitedBlocks` | `number (required)` | `ExplosionBlockCount (required)` | `ExplosionBlockCount.result(value)` (mc-kernel) |
| `ExplosionPlan` | `radius` | `number (required)` | `ExplosionRadius (required)` | `ExplosionRadius.result(value)` (mc-kernel) |
| `ExplosionPlan` | `seed` | `number (required)` | `RandomSeed (required)` | `RandomSeed.result(value)` (mc-kernel) |
| `ExplosionPlan` | `visitedBlocks` | `number (required)` | `ExplosionBlockCount (required)` | `ExplosionBlockCount.result(value)` (mc-kernel) |
| `ExplosionRequest` | `radius` | `number (required)` | `ExplosionRadius (required)` | `ExplosionRadius.result(value)` (mc-kernel) |
| `ExplosionRequest` | `seed` | `number (required)` | `RandomSeed (required)` | `RandomSeed.result(value)` (mc-kernel) |
| `FallTrackingState` | `accumulatedFallDistance` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `FluidEffects` | `flow` | `Position (required)` | `FluidFlow (required)` | — |
| `FluidMotionCoefficients` | `lava` | `Readonly<{ readonly dragPerSecond: number; readonly dragPerSecondY?: number; readonly buoyancyAcceleration: number; readonly flowAcceleration: number; }> (required)` | `Readonly<{ readonly dragPerSecond: PerSecond; readonly dragPerSecondY?: PerSecond; readonly buoyancyAcceleration: BlocksPerSecondSquared; readonly flowAcceleration: BlocksPerSecondSquared; }> (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics); `PerSecond.result(value)` (mc-physics) |
| `FluidMotionCoefficients` | `water` | `Readonly<{ readonly dragPerSecond: number; readonly dragPerSecondY?: number; readonly buoyancyAcceleration: number; readonly flowAcceleration: number; }> (required)` | `Readonly<{ readonly dragPerSecond: PerSecond; readonly dragPerSecondY?: PerSecond; readonly buoyancyAcceleration: BlocksPerSecondSquared; readonly flowAcceleration: BlocksPerSecondSquared; }> (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics); `PerSecond.result(value)` (mc-physics) |
| `FluidState` | `flow` | `Position (required)` | `FluidFlow (required)` | — |
| `GlideConfig` | `climbConversionPerSecond` | `number (required)` | `PerSecond (required)` | `PerSecond.result(value)` (mc-physics) |
| `GlideConfig` | `diveConversionPerSecond` | `number (required)` | `BlocksPerSecondSquared (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `GlideConfig` | `gravityPerSecondSquared` | `number (required)` | `BlocksPerSecondSquared (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `GlideConfig` | `horizontalDragPerSecond` | `number (required)` | `PerSecond (required)` | `PerSecond.result(value)` (mc-physics) |
| `GlideConfig` | `turnRatePerSecond` | `number (required)` | `PerSecond (required)` | `PerSecond.result(value)` (mc-physics) |
| `GlideConfig` | `verticalDragPerSecond` | `number (required)` | `PerSecond (required)` | `PerSecond.result(value)` (mc-physics) |
| `GlideSight` | `pitchRadians` | `number (required)` | `AngleRadians (required)` | `AngleRadians.result(value)` (mc-kernel) |
| `GlideSight` | `yawRadians` | `number (required)` | `AngleRadians (required)` | `AngleRadians.result(value)` (mc-kernel) |
| `HorizontalPosition` | `x` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `HorizontalPosition` | `z` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `IntegrationOptions` | `gravityY` | `number (optional)` | `BlocksPerSecondSquared (optional)` | `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `IntegrationOptions` | `terminalVelocityY` | `number (optional)` | `BlocksPerSecond (optional)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `KernelResolveOptions` | `halfWidth` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `KernelResolveOptions` | `stepHeight` | `number (optional)` | `BlockLength (optional)` | `BlockLength.result(value)` (mc-physics) |
| `LandingImpact` | `fallDistance` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `LandingImpact` | `impactVelocityY` | `number (required)` | `BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `MovementConfig` | `airAcceleration` | `number (required)` | `BlocksPerSecondSquared (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `MovementConfig` | `fluidAscentAcceleration` | `number (required)` | `BlocksPerSecondSquared (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `MovementConfig` | `fluidAscentMaxSpeed` | `number (required)` | `BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `MovementConfig` | `groundAcceleration` | `number (required)` | `BlocksPerSecondSquared (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `MovementConfig` | `jumpVelocity` | `number (required)` | `BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `MovementConfig` | `sneakMultiplier` | `∅` | `number (required)` | — |
| `MovementConfig` | `walkSpeed` | `number (required)` | `BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `MovementInput` | `sneak` | `∅` | `boolean (required)` | — |
| `MovementInput` | `yawRadians` | `number (required)` | `AngleRadians (required)` | `AngleRadians.result(value)` (mc-kernel) |
| `PistonBlockMove` | `distance` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `PistonExtrusion` | `displacement` | `Position (required)` | `BlockVector (required)` | `blockVectorResult(x, y, z)` (mc-physics) |
| `Position` | `x` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `Position` | `y` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `Position` | `z` | `number (required)` | `PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `Projectile` | `ageSeconds` | `number (required)` | `FixedDurationSecs (required)` | `FixedDurationSecs.result(value)` (mc-kernel) |
| `Projectile` | `shooterId` | `string (optional)` | `EntityIdValue (optional)` | `EntityId.result(value)` (mc-kernel) |
| `Projectile` | `velocity` | `Position (required)` | `VelocityVector (required)` | `velocityVectorResult(x, y, z)` (mc-physics) |
| `ProjectileEntity` | `id` | `string (required)` | `EntityIdValue (required)` | `EntityId.result(value)` (mc-kernel) |
| `ProjectileHit` (entity variant) | `entityId` | `string (required)` | `EntityIdValue (required)` | `EntityId.result(value)` (mc-kernel) |
| `ProjectileHit` | `flightTimeSeconds` | `number (required)` | `FixedDurationSecs (required)` | `FixedDurationSecs.result(value)` (mc-kernel) |
| `ProjectileLaunch` | `pitchRadians` | `number (required)` | `AngleRadians (required)` | `AngleRadians.result(value)` (mc-kernel) |
| `ProjectileLaunch` | `shooterId` | `string (optional)` | `EntityIdValue (optional)` | `EntityId.result(value)` (mc-kernel) |
| `ProjectileLaunch` | `speed` | `number (required)` | `BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics) |
| `ProjectileLaunch` | `yawRadians` | `number (required)` | `AngleRadians (required)` | `AngleRadians.result(value)` (mc-kernel) |
| `ProjectileProfile` | `gravity` | `number (required)` | `BlocksPerSecondSquared (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `ProjectileProfile` | `maxLifetimeSeconds` | `number (required)` | `FixedDurationSecs (required)` | `FixedDurationSecs.result(value)` (mc-kernel) |
| `ProjectileProfile` | `shooterGraceSeconds` | `number (required)` | `FixedDurationSecs (required)` | `FixedDurationSecs.result(value)` (mc-kernel) |
| `Resolution` | `hazards` | `∅` | `BlockHazards (required)` | — |
| `ResolveOptions` | `bouncinessAt` | `(bx: number, by: number, bz: number) => number (optional)` | `(bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => number (optional)` | `BlockAxis.result(value)` (mc-kernel) |
| `ResolveOptions` | `environment` | `∅` | `BlockEnvironment (required)` | [blockEnvironmentFromKernel](./public-api.md#collision-resolution-and-environment); [resolveOptionsFromKernel](./public-api.md#collision-resolution-and-environment) |
| `ResolveOptions` | `halfWidth` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `ResolveOptions` | `stepHeight` | `number (optional)` | `BlockLength (optional)` | `BlockLength.result(value)` (mc-physics) |
| `VoxelHit` | `bx` | `number (required)` | `BlockAxis (required)` | `BlockAxis.result(value)` (mc-kernel) |
| `VoxelHit` | `by` | `number (required)` | `BlockAxis (required)` | `BlockAxis.result(value)` (mc-kernel) |
| `VoxelHit` | `bz` | `number (required)` | `BlockAxis (required)` | `BlockAxis.result(value)` (mc-kernel) |
| `VoxelHit` | `distance` | `number (required)` | `BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |

### Decoding DamageAmount

DamageAmount is defined by DamageAmountSchema. Decode unknown input with Schema.decodeUnknownResult to preserve schema failures as a Result.

```ts
import { Result, Schema } from "effect"
import { DamageAmountSchema } from "@nerima-games/mc-kernel"

const decodeDamage = (rawDamage: unknown) => {
  const decoded = Schema.decodeUnknownResult(DamageAmountSchema)(rawDamage)
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure)
  return Result.succeed(decoded.success)
}
```
## Migration notes

### Explosion and primed TNT execution

The removed explosion and primed-TNT execution exports are now owned by [mc-sim](https://github.com/nerima-games/mc-sim). This package does not provide a replacement execution entry point. Coordinate the move with the matching mc-sim update. Shared explosion data types and `DEFAULT_EXPLOSION_LIMITS` remain available from mc-physics and are defined by mc-kernel.

### Frame delta boundary

The removed `clampDeltaTime` accepted a raw number. Its replacement, the re-exported kernel `clampFrameDelta`, accepts a `DeltaTimeSecs` brand. For a raw delta, create it with `DeltaTimeSecs.result(rawDeltaSecs)`, handle a failure, then pass `.success` to `clampFrameDelta`. For timestamp readings, `deltaTimeBetween(previousSecs, currentSecs)` validates both readings, computes the interval through kernel `frameDeltaBetween`, applies the frame clamp, and returns a `Result`. `integrateBody` consumes a branded `DeltaTimeSecs` for one fixed step and does not apply a frame clamp internally.

### Environment callbacks and collision shapes

`BlockAt` and `BlockPropertiesAt` callbacks return `Result`. A successful `null` means the block ID is absent or resolves to an empty block; a successful registry lookup returning `undefined` also means no block. A validation or registry-resolution failure must remain a failure so collision and hazard sampling can stop safely.

`CollisionShape` is available through the public kernel root or the `@nerima-games/mc-kernel/domain/block-properties` subpath. Deep imports into kernel implementation files are not package exports.

### Hazards, movement, and projectiles

`Resolution` includes `hazards`, sampled once from the post-collision body AABB through the supplied block environment. It contains contact damage, suffocation, and climbability data. The host still owns applying contact damage or other effects.

Movement input includes sneak behavior. Creative-flight transitions are exposed as pure state functions in `creative-flight`; the host owns input event timing and game-state application.

The generic projectile engine remains in mc-physics, with `Projectile`, `ProjectileLaunch`, `ARROW_PROFILE`, `launchProjectile`, and `stepProjectile`.
