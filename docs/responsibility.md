# Responsibilities

`mc-physics` is a pure computation library for a voxel world. It accepts explicit body state, block and entity queries, and timing inputs, then returns validated results. It does not read clocks, access chunks, or mutate game state.

## Calculations owned here

- Coordinate and AABB construction, block occupancy, and foot/centre conversions.
- Fixed-step integration, swept movement, block collision resolution, support checks, and sneak-edge clamping.
- Voxel DDA ray traversal and shape narrow-phase checks.
- Surface, fluid, and block-hazard sampling from an injected `BlockEnvironment`.
- Walk, sprint, sneak, jump, knockback, and creative-flight movement calculations.
- Generic projectile launch and stepping with injected profiles and world queries.
- Entity collision detection and mass-based collision resolution.
- Falling-block start candidates, landing-impact projections, elytra glide steps, and piston extrusion geometry.

`stepBody` combines integration and block resolution. A resolved result includes the body, grounded state, and hazards sampled once from the post-collision AABB. The caller decides how to apply contact damage, suffocation, or climbing behavior.

## Inputs and validation

World access is provided through callback interfaces. `BlockEnvironment` supplies kernel block properties and capabilities, with optional state-specific collision shapes. Registry lookup adapters are provided by `kernel-world`; chunk access and registry ownership remain with the caller.

The public API uses mc-kernel brands for shared coordinates, time, angles, block identifiers, entity identifiers, fluid kinds, and contact damage. Physics-specific dimensions, velocity, acceleration, and mass use the semantic types defined here. Invalid inputs or derived values are returned through Effect 4 `Result` where the caller must handle failure. APIs that treat invalid external data as absent use `Option`.

Use mc-kernel's `clampFrameDelta` at the frame boundary. `integrateBody` consumes one fixed-step delta and does not clamp it. `deltaTimeBetween` receives monotonic timestamp readings; it never reads a clock.

## Caller-owned behavior

| Responsibility | Owner |
| --- | --- |
| Chunk and registry storage, entity collections, tick order, and persistence | `mc-sim` and the host |
| Applying contact damage, suffocation, fall damage, health, and status changes | `mc-sim` / gameplay |
| Block mutation, drops, and entity lifecycle | `mc-sim` / gameplay |
| Explosion and primed TNT execution | `mc-sim` |
| Creative-flight input events and applying game-mode state | `mc-sim` / host |
| Fluid propagation and block-state updates | gameplay |
| Edition-specific block data and tuning | mc-kernel / gameplay |
| Piston power and movable-block decisions | redstone / `mc-sim` |

mc-physics re-exports mc-kernel's shared explosion data types and `DEFAULT_EXPLOSION_LIMITS`, but it does not export explosion or primed TNT execution functions. Projectile calculation remains owned by mc-physics; persistent arrows, inventory use, and damage application belong to higher layers.

## Dependency boundary

The only `@nerima-games/*` runtime dependency is `@nerima-games/mc-kernel`. The package does not depend on game, rendering, chunk, or entity-management implementations. It has no external physics-engine dependency.

The library does not claim complete Minecraft compatibility by itself. A caller must provide a specific edition's block properties, geometry, projectile profiles, game-mode policy, and state application.
