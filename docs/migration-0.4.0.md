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

## Machine-generated API comparison: published 0.3.0 → 0.4.0

Compared the published 0.3.0 package at `dist/index.d.ts` with the head package at `dist/index.d.ts` using the TypeScript checker and declaration annotations. The scanner resolved all exports, reported zero semantic diagnostics for both packages, and found 148 base exports and 156 head exports (13 removed and 21 added). Counts below are changed export/parameter/return/field entries; repeated parameter changes are grouped by callback or function. Parameter entries contain 46 type changes and 0 parameter additions, removals, or optionality changes.

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
| `applySurfaceMotion` | `Body` | `Result.Result<Body, Brand.BrandError>` | — |
| `blockAABB` | `AABB` | `Result.Result<AABB, Brand.BrandError \| RangeError>` | — |
| `centreOfFoot` | `CentreY` | `Result.Result<CentreY, Brand.BrandError>` | `CentreY.result(value)` (mc-physics) |
| `collisionOf` | `EntityCollision \| null` | `Result.Result<EntityCollision \| null, Brand.BrandError \| RangeError>` | — |
| `deltaTimeBetween` | `DeltaTimeSecs` | `Result.Result<DeltaTimeSecs, Brand.BrandError>` | `DeltaTimeSecs.result(value)` (mc-kernel) |
| `detectEntityCollisions` | `ReadonlyArray<EntityCollision>` | `Result.Result<ReadonlyArray<EntityCollision>, Brand.BrandError \| RangeError>` | — |
| `entityAABB` | `AABB` | `Result.Result<AABB, Brand.BrandError \| RangeError>` | — |
| `fallingBlockCandidateAt` | `FallingBlockCandidate \| null` | `Result.Result<FallingBlockCandidate \| null, FallingBlockCandidateError>` | — |
| `footOfCentre` | `FootY` | `Result.Result<FootY, Brand.BrandError>` | `FootY.result(value)` (mc-physics) |
| `glideStep` | `Position` | `Result.Result<VelocityVector, Brand.BrandError>` | `velocityVectorResult(x, y, z)` (mc-physics) |
| `integrate` | `ReadonlyArray<Body>` | `Result.Result<ReadonlyArray<Body>, Brand.BrandError>` | — |
| `integrateBody` | `Body` | `Result.Result<Body, Brand.BrandError>` | — |
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

### Exported interface/type field changes (91: 87 type changes, 4 additions, 0 removals, 0 optionality changes)

| Exported type | 0.3.0 fields | 0.4.0 fields | Create branded values with |
| --- | --- | --- | --- |
| `AABB` | `maxX: number (required); maxY: number (required); maxZ: number (required); minX: number (required); minY: number (required); minZ: number (required)` | `maxX: PositionAxis (required); maxY: PositionAxis (required); maxZ: PositionAxis (required); minX: PositionAxis (required); minY: PositionAxis (required); minZ: PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `BlockHazards` | `contactDamage: number (required)` | `contactDamage: BlockContactDamage (required)` | `BlockContactDamage.result(value)` (mc-kernel) |
| `Body` | `vx: number (required); vy: number (required); vz: number (required); x: number (required); z: number (required)` | `vx: BlocksPerSecond (required); vy: BlocksPerSecond (required); vz: BlocksPerSecond (required); x: PositionAxis (required); z: PositionAxis (required)` | `BlocksPerSecond.result(value)` (mc-physics); `PositionAxis.result(value)` (mc-kernel) |
| `EntityCollider` | `halfWidth: number (required); id: string (required); mass: number (required)` | `halfWidth: BlockLength (required); id: EntityIdValue (required); mass: MassValue \| 0 (required)` | `BlockLength.result(value)` (mc-physics); `EntityId.result(value)` (mc-kernel); `Mass.result(value)` (mc-physics) |
| `EntityCollision` | `firstId: string (required); penetration: number (required); secondId: string (required)` | `firstId: EntityIdValue (required); penetration: BlockLength (required); secondId: EntityIdValue (required)` | `BlockLength.result(value)` (mc-physics); `EntityId.result(value)` (mc-kernel) |
| `EntityCollisionOptions` | `cellSize: number (required)` | `cellSize: BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `ExplosionBlock` | `resistance: number (required)` | `resistance: BlockBlastResistance (required)` | `BlockBlastResistance.result(value)` (mc-kernel) |
| `ExplosionBlockPosition` | `x: number (required); y: number (required); z: number (required)` | `x: PositionAxis (required); y: PositionAxis (required); z: PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `ExplosionEntity` | `id: string (required)` | `id: EntityId (required)` | `EntityId.result(value)` (mc-kernel) |
| `ExplosionEntityEffect` | `damage: number (required); exposure: number (required); id: string (required)` | `damage: DamageAmount (required); exposure: ExplosionExposure (required); id: EntityId (required)` | `EntityId.result(value)` (mc-kernel); `ExplosionExposure.result(value)` (mc-kernel) |
| `ExplosionLimits` | `maxAffectedEntities: number (required); maxRaySteps: number (required); maxVisitedBlocks: number (required)` | `maxAffectedEntities: ExplosionEntityCount (required); maxRaySteps: ExplosionRayStepCount (required); maxVisitedBlocks: ExplosionBlockCount (required)` | `ExplosionBlockCount.result(value)` (mc-kernel); `ExplosionEntityCount.result(value)` (mc-kernel); `ExplosionRayStepCount.result(value)` (mc-kernel) |
| `ExplosionPlan` | `radius: number (required); seed: number (required); visitedBlocks: number (required)` | `radius: ExplosionRadius (required); seed: RandomSeed (required); visitedBlocks: ExplosionBlockCount (required)` | `ExplosionBlockCount.result(value)` (mc-kernel); `ExplosionRadius.result(value)` (mc-kernel); `RandomSeed.result(value)` (mc-kernel) |
| `ExplosionRequest` | `radius: number (required); seed: number (required)` | `radius: ExplosionRadius (required); seed: RandomSeed (required)` | `ExplosionRadius.result(value)` (mc-kernel); `RandomSeed.result(value)` (mc-kernel) |
| `FallTrackingState` | `accumulatedFallDistance: number (required)` | `accumulatedFallDistance: BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `FluidEffects` | `flow: Position (required)` | `flow: FluidFlow (required)` | — |
| `FluidMotionCoefficients` | `lava: Readonly<{ readonly dragPerSecond: number; readonly dragPerSecondY?: number; readonly buoyancyAcceleration: number; readonly flowAcceleration: number; }> (required); water: Readonly<{ readonly dragPerSecond: number; readonly dragPerSecondY?: number; readonly buoyancyAcceleration: number; readonly flowAcceleration: number; }> (required)` | `lava: Readonly<{ readonly dragPerSecond: PerSecond; readonly dragPerSecondY?: PerSecond; readonly buoyancyAcceleration: BlocksPerSecondSquared; readonly flowAcceleration: BlocksPerSecondSquared; }> (required); water: Readonly<{ readonly dragPerSecond: PerSecond; readonly dragPerSecondY?: PerSecond; readonly buoyancyAcceleration: BlocksPerSecondSquared; readonly flowAcceleration: BlocksPerSecondSquared; }> (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics); `PerSecond.result(value)` (mc-physics) |
| `FluidState` | `flow: Position (required)` | `flow: FluidFlow (required)` | — |
| `GlideConfig` | `climbConversionPerSecond: number (required); diveConversionPerSecond: number (required); gravityPerSecondSquared: number (required); horizontalDragPerSecond: number (required); turnRatePerSecond: number (required); verticalDragPerSecond: number (required)` | `climbConversionPerSecond: PerSecond (required); diveConversionPerSecond: BlocksPerSecondSquared (required); gravityPerSecondSquared: BlocksPerSecondSquared (required); horizontalDragPerSecond: PerSecond (required); turnRatePerSecond: PerSecond (required); verticalDragPerSecond: PerSecond (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics); `PerSecond.result(value)` (mc-physics) |
| `GlideSight` | `pitchRadians: number (required); yawRadians: number (required)` | `pitchRadians: AngleRadians (required); yawRadians: AngleRadians (required)` | `AngleRadians.result(value)` (mc-kernel) |
| `HorizontalPosition` | `x: number (required); z: number (required)` | `x: PositionAxis (required); z: PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `IntegrationOptions` | `gravityY: number (optional); terminalVelocityY: number (optional)` | `gravityY: BlocksPerSecondSquared (optional); terminalVelocityY: BlocksPerSecond (optional)` | `BlocksPerSecond.result(value)` (mc-physics); `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `KernelResolveOptions` | `halfWidth: number (required); stepHeight: number (optional)` | `halfWidth: BlockLength (required); stepHeight: BlockLength (optional)` | `BlockLength.result(value)` (mc-physics) |
| `LandingImpact` | `fallDistance: number (required); impactVelocityY: number (required)` | `fallDistance: BlockLength (required); impactVelocityY: BlocksPerSecond (required)` | `BlockLength.result(value)` (mc-physics); `BlocksPerSecond.result(value)` (mc-physics) |
| `MovementConfig` | `airAcceleration: number (required); fluidAscentAcceleration: number (required); fluidAscentMaxSpeed: number (required); groundAcceleration: number (required); jumpVelocity: number (required); sneakMultiplier: ∅; walkSpeed: number (required)` | `airAcceleration: BlocksPerSecondSquared (required); fluidAscentAcceleration: BlocksPerSecondSquared (required); fluidAscentMaxSpeed: BlocksPerSecond (required); groundAcceleration: BlocksPerSecondSquared (required); jumpVelocity: BlocksPerSecond (required); sneakMultiplier: number (required); walkSpeed: BlocksPerSecond (required)` | `BlocksPerSecond.result(value)` (mc-physics); `BlocksPerSecondSquared.result(value)` (mc-physics) |
| `MovementInput` | `sneak: ∅; yawRadians: number (required)` | `sneak: boolean (required); yawRadians: AngleRadians (required)` | `AngleRadians.result(value)` (mc-kernel) |
| `PistonBlockMove` | `distance: number (required)` | `distance: BlockLength (required)` | `BlockLength.result(value)` (mc-physics) |
| `PistonExtrusion` | `displacement: Position (required)` | `displacement: BlockVector (required)` | `blockVectorResult(x, y, z)` (mc-physics) |
| `Position` | `x: number (required); y: number (required); z: number (required)` | `x: PositionAxis (required); y: PositionAxis (required); z: PositionAxis (required)` | `PositionAxis.result(value)` (mc-kernel) |
| `Projectile` | `ageSeconds: number (required); shooterId: string (optional); velocity: Position (required)` | `ageSeconds: FixedDurationSecs (required); shooterId: EntityIdValue (optional); velocity: VelocityVector (required)` | `EntityId.result(value)` (mc-kernel); `FixedDurationSecs.result(value)` (mc-kernel); `velocityVectorResult(x, y, z)` (mc-physics) |
| `ProjectileEntity` | `id: string (required)` | `id: EntityIdValue (required)` | `EntityId.result(value)` (mc-kernel) |
| `ProjectileHit` | `flightTimeSeconds: number (required)` | `flightTimeSeconds: FixedDurationSecs (required)` | `FixedDurationSecs.result(value)` (mc-kernel) |
| `ProjectileLaunch` | `pitchRadians: number (required); shooterId: string (optional); speed: number (required); yawRadians: number (required)` | `pitchRadians: AngleRadians (required); shooterId: EntityIdValue (optional); speed: BlocksPerSecond (required); yawRadians: AngleRadians (required)` | `AngleRadians.result(value)` (mc-kernel); `BlocksPerSecond.result(value)` (mc-physics); `EntityId.result(value)` (mc-kernel) |
| `ProjectileProfile` | `gravity: number (required); maxLifetimeSeconds: number (required); shooterGraceSeconds: number (required)` | `gravity: BlocksPerSecondSquared (required); maxLifetimeSeconds: FixedDurationSecs (required); shooterGraceSeconds: FixedDurationSecs (required)` | `BlocksPerSecondSquared.result(value)` (mc-physics); `FixedDurationSecs.result(value)` (mc-kernel) |
| `Resolution` | `hazards: ∅` | `hazards: BlockHazards (required)` | — |
| `ResolveOptions` | `bouncinessAt: (bx: number, by: number, bz: number) => number (optional); environment: ∅; halfWidth: number (required); stepHeight: number (optional)` | `bouncinessAt: (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => number (optional); environment: BlockEnvironment (required); halfWidth: BlockLength (required); stepHeight: BlockLength (optional)` | `BlockAxis.result(value)` (mc-kernel); `BlockLength.result(value)` (mc-physics) |
| `VoxelHit` | `bx: number (required); by: number (required); bz: number (required); distance: number (required)` | `bx: BlockAxis (required); by: BlockAxis (required); bz: BlockAxis (required); distance: BlockLength (required)` | `BlockAxis.result(value)` (mc-kernel); `BlockLength.result(value)` (mc-physics) |


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