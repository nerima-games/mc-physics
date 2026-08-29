import type { AABB } from './coordinates'
import type { CollisionShape } from '@nerima-games/mc-kernel'

/** The shape a full block occupies within its own cell: the whole unit cube. */
export const FULL_BLOCK_SHAPE: AABB = {
  maxX: 1,
  maxY: 1,
  maxZ: 1,
  minX: 0,
  minY: 0,
  minZ: 0,
}

/** A slab: the bottom half of its cell. */
export const SLAB_SHAPE: AABB = { ...FULL_BLOCK_SHAPE, maxY: 0.5 }

/**
 * One Minecraft "pixel": a sixteenth of a block, the finest granularity block
 * shapes are authored at. `0.0625` rather than `1 / 16`: a division expression
 * is not a bare-literal `const` initializer, so the linter cannot see it as
 * the named constant it is meant to be — and unlike most fractions, sixteenths
 * are exact in IEEE-754 (16 is a power of two), so the decimal form loses
 * nothing.
 */
const SIXTEENTH = 0.0625

/** A pressure plate: the bottom sixteenth of its cell. */
export const PRESSURE_PLATE_SHAPE: AABB = { ...FULL_BLOCK_SHAPE, maxY: SIXTEENTH }

/** A cactus: a full-height block inset one sixteenth on both horizontal axes. */
export const CACTUS_SHAPE: AABB = {
  ...FULL_BLOCK_SHAPE,
  maxX: 1 - SIXTEENTH,
  maxZ: 1 - SIXTEENTH,
  minX: SIXTEENTH,
  minZ: SIXTEENTH,
}

export const COLLISION_SHAPE_AABBS: Readonly<Record<CollisionShape, AABB | null>> = {
  cactus: CACTUS_SHAPE,
  full: FULL_BLOCK_SHAPE,
  none: null,
  pressurePlate: PRESSURE_PLATE_SHAPE,
  slab: SLAB_SHAPE,
}
