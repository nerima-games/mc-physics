# Public API

`@nerima-games/mc-physics` 0.4.0 exposes its supported API from the package root. The package contains pure physics calculations; callers own world storage, clocks, applying returned state, and game rules.

## Validation and errors

Effect 4 `Result` is used when a calculation can fail while validating input or a derived value. Geometry sampling and collision APIs can return `BrandError` or `RangeError`; check each function's TypeScript signature for its error type. Functions that search for a value may instead return `null` or an Effect `Option`, as stated by their signature.

Effect 4 brand constructors validate values. A direct constructor call throws `BrandError` for invalid input. Use a constructor's `.option(value)` when invalid input means “absent”, or `.result(value)` when the caller must handle the failure. Constructors are suitable for constants and values already known to satisfy the refinement.

## Coordinates, shapes, and units

The package re-exports mc-kernel's `Position` type and `position` constructor. Kernel brands such as `PositionAxis`, `BlockAxis`, `BlockId`, `EntityId`, `AngleRadians`, and `BlockContactDamage` are used at API boundaries; import those brands from `@nerima-games/mc-kernel` when constructing values.

`FootY` and `CentreY` are finite local brands. `HalfHeight` is positive and finite. `Body.y` is the entity centre Y. `AABB` is a flat `{ minX, minY, minZ, maxX, maxY, maxZ }` box whose coordinates use `PositionAxis`; `BlockShape` is one local AABB or an array of them. The package also exports `entityAABB`, `blockAABB`, shape lookup helpers, intersection predicates, and the standard full block, slab, pressure plate, and cactus shapes.

Physics-specific brands are exported for `BlockLength`, `BlocksPerSecond`, `BlocksPerSecondSquared`, `PerSecond`, `Mass`, and `InverseMass`, along with `BlockVector`, `VelocityVector`, `blockVectorResult`, and `velocityVectorResult`. Dimensionless coefficients and movement axes remain numbers.

## Time

`DeltaTimeSecs`, `MonotonicTimeSecs`, `MIN_DELTA_SECS`, `MAX_DELTA_SECS`, `FIRST_FRAME_DELTA_SECS`, and `clampFrameDelta` come from mc-kernel. The exported `clampFrameDelta` is the frame-boundary clamp. `deltaTimeBetween(previousSecs, currentSecs)` validates monotonic readings and returns a `Result<DeltaTimeSecs, BrandError>`; `undefined` for the previous reading selects the first-frame delta. `isClampedDelta` checks whether a kernel delta is within the safe frame range.

`integrateBody` advances one `Body` using semi-implicit Euler and returns `Result<Body, BrandError>`. `integrate` applies that operation to a body array and returns `Result<ReadonlyArray<Body>, BrandError>`. `IntegrationOptions` can override gravity, per-second drag, and terminal downward speed. The integrator does not clamp the delta; frame loops clamp once at their boundary, while fixed-step callers pass their validated step directly. `GRAVITY_Y`, `TERMINAL_VELOCITY_Y`, and `maxFallPerStep` are also exported.

## Collision resolution and environment

`ResolveOptions` supplies body dimensions, a required `BlockEnvironment`, and a block-properties lookup, with optional block geometry, step height, and bounce coefficient lookup. `resolveBody`, `resolveWorld`, `stepBody`, and `stepWorld` return `Result` values. `stepBody` and `stepWorld` integrate before resolving collision.

`Resolution` contains the resolved `body`, `isGrounded`, and `hazards`. `hazards` contains `contactDamage`, `suffocating`, and `climbable`. The resolver calls `sampleBlockHazards` once for the final post-collision AABB, including when the resolved body is not dynamic. `sampleBlockHazards` returns `Result<BlockHazards, EnvironmentError>`. The caller decides how to apply contact damage, suffocation, or climbing effects.

`BlockEnvironment` injects a block sample query and may supply state-specific geometry. `BlockAt` and `BlockPropertiesAt` return Effect `Result` values so ID validation and registry-resolution failures reach the caller. `blockAtFromKernel`, `blockPropertiesAtFromKernel`, `blockEnvironmentFromKernel`, and `resolveOptionsFromKernel` adapt a numeric block-ID query to the package contracts. A missing or empty ID, or a successful registry lookup that returns `undefined`, becomes `Result.succeed(null)`; validation and registry failures remain `Result` failures.

`sampleSurfaceEffects` returns `Result<SurfaceEffects, EnvironmentError>`, and `sampleFluidEffects` returns `Result<FluidEffects, EnvironmentError>`. `applySurfaceMotion` and `applyFluidMotion` return `Result<Body, BrandError>`. Fluid state and motion configuration are injected. `FlowingFluidKind` and the other shared block contracts come from mc-kernel.

## Movement and creative flight

`MovementInput` carries forward and strafe axes, yaw, sprint, sneak, and jump input. `MovementConfig` supplies speeds and accelerations. `applyMovementInput` and `applyKnockback` return `Result<Body, BrandError>`; sneak speed takes precedence over sprint speed, and knockback applies a validated velocity impulse.

`CreativeFlightState` and `CreativeFlightInput` support pure flight state transitions. `createCreativeFlightState` starts disabled. `toggleCreativeFlight(state, canFly, togglePressed)` handles one toggle event per call and disables flight when `canFly` is false. `applyCreativeFlightInput` returns `Result<Body, BrandError>` and sets `body.vy` while flight is enabled; no vertical key, or both vertical keys, sets `body.vy` to zero. It does not change game mode or automatically disable flight on landing. The host owns event timing and the game-mode state; host-level flight controls belong in the host's E2E tests.

## Queries and other calculations

- `voxelRaycast` traverses block cells and tests injected block shapes.
- The projectile API exports `Projectile`, `ProjectileLaunch`, `ProjectileProfile`, `ProjectileWorld`, hit and step types, `ARROW_PROFILE`, `SNOWBALL_PROFILE`, `EGG_PROFILE`, and `TRIDENT_PROFILE`. `launchProjectile` creates generic launch kinematics; `stepProjectile` applies the selected profile and swept collision against injected blocks and entities.
- Entity collision exports `detectEntityCollisions` for spatially indexed collision detection and `resolveEntityCollisions` for mass-based resolution. `EntityCollision` contains `firstId`, `secondId`, `normal`, and `penetration`. Entity IDs, body dimensions, masses, and collision configuration use the corresponding branded types.
- `advanceFallTracking` reports landing impact data from successive bodies and a `Resolution`. `fallingBlockCandidateAt` queries kernel block IDs and capabilities. `pistonExtrusion` computes the displacement from one moving block against an entity AABB. `glideStep` applies the configured glide model.

## Explosion data ownership

mc-physics re-exports `DEFAULT_EXPLOSION_LIMITS` and `ExplosionBlock`, `ExplosionBlockPosition`, `ExplosionBlockReader`, `ExplosionCommit`, `ExplosionEntity`, `ExplosionEntityEffect`, `ExplosionLimits`, `ExplosionMutation`, `ExplosionPlan`, and `ExplosionRequest` from mc-kernel. It does not export explosion or primed TNT planning, mutation, or execution functions. Those operations belong to mc-sim.

See [migration-0.4.0.md](./migration-0.4.0.md) for breaking changes from 0.3.x and migration steps.
