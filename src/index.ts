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
 * collision shapes, and explosion/primed-TNT planning come directly from
 * mc-kernel and are re-exported below so consumers keep one import path.
 *
 * Body-coordinate brands in `domain/coordinates.ts` keep foot-origin Y,
 * centre Y, and half-height distinct throughout the physics path.
 */

export * from './domain/coordinates'
export * from './domain/dda'
export * from './domain/delta-time'
export * from './domain/entity-collision'
export * from './domain/environment'
export * from './domain/environment-types'
export * from './domain/falling-block'
export * from './domain/fluid'
export * from './domain/integrate'
export * from './domain/kernel-world'
export * from './domain/landing'
export * from './domain/movement'
export * from './domain/projectile'
export * from './domain/resolve'

export {
  applyExplosionPlan,
  DEFAULT_EXPLOSION_LIMITS,
  planExplosion,
} from '@nerima-games/mc-kernel'
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
export {
  applyPrimedTntPlan,
  DEFAULT_TNT_FUSE_SECS,
  MAX_TNT_FUSE_ADVANCE_SECS,
  planPrimedTnt,
  primeTnt,
} from '@nerima-games/mc-kernel'
export type {
  PrimedTntCommit,
  PrimedTntMutation,
  PrimedTntPlan,
  PrimedTntRequest,
  PrimedTntState,
} from '@nerima-games/mc-kernel'
