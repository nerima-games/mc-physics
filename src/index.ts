/**
 * Pure voxel physics primitives: semi-implicit Euler integration, AABB
 * collision resolution, voxel traversal, projectile intersection, and
 * environment/entity interaction.
 *
 * The world boundary is an injected query returning mc-kernel's
 * `BlockProperties` (or `null`). `kernel-world` connects a block-id query to
 * that contract without copying registry data. A caller may provide
 * state-specific or compound geometry, fluid state, and entity collections
 * separately. Chunk lookup, clocks, rendering, and entity orchestration
 * remain outside this package; block properties, capabilities, basic
 * collision shapes, and shared explosion data come directly from mc-kernel.
 * This package re-exports those contracts while mc-sim owns execution.
 *
 * Body-coordinate brands in `domain/coordinates.ts` keep foot-origin Y,
 * centre Y, and half-height distinct throughout the physics path.
 */

export * from './domain/coordinates.js'
export * from './domain/creative-flight.js'
export * from './domain/dda.js'
export * from './domain/delta-time.js'
export * from './domain/entity-collision.js'
export * from './domain/entity-collision-resolve.js'
export * from './domain/environment.js'
export * from './domain/environment-types.js'
export * from './domain/falling-block.js'
export * from './domain/fluid.js'
/*
 * Glide exports are named rather than starred: the GLIDE_* calibration
 * constants exist for DEFAULT_GLIDE_CONFIG's derivation and its tests, and
 * publishing eight tuning scalars alongside the config object they feed
 * would double the surface without adding a capability.
 */
export { DEFAULT_GLIDE_CONFIG, glideStep } from './domain/glide.js'
export type { GlideConfig, GlideSight } from './domain/glide.js'
export * from './domain/integrate.js'
export * from './domain/kernel-world.js'
export * from './domain/landing.js'
export * from './domain/movement.js'
export * from './domain/piston.js'
export * from './domain/physical-units.js'
export * from './domain/projectile.js'
export * from './domain/resolve.js'
export * from './domain/shape-data.js'

export { DEFAULT_EXPLOSION_LIMITS } from '@nerima-games/mc-kernel'
export type {
  ExplosionBlock,
  ExplosionBlockPosition,
  ExplosionBlockReader,
  ExplosionCommit,
  ExplosionEntity,
  ExplosionEntityEffect,
  ExplosionLimits,
  ExplosionMutation,
  ExplosionPlan,
  ExplosionRequest,
} from '@nerima-games/mc-kernel'
