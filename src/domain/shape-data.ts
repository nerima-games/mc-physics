import { type CollisionShape, PositionAxis } from '@nerima-games/mc-kernel'
import type { AABB } from './coordinates.js'

const HALF_BLOCK = 0.5
const ONE_SIXTEENTH = 0.0625
const FIFTEEN_SIXTEENTHS = 0.9375

/** The shape a full block occupies within its own cell: the whole unit cube. */
export const FULL_BLOCK_SHAPE: AABB = {
  maxX: PositionAxis(1),
  maxY: PositionAxis(1),
  maxZ: PositionAxis(1),
  minX: PositionAxis(0),
  minY: PositionAxis(0),
  minZ: PositionAxis(0),
}

/** A slab: the bottom half of its cell. */
export const SLAB_SHAPE: AABB = { ...FULL_BLOCK_SHAPE, maxY: PositionAxis(HALF_BLOCK) }

/** A pressure plate: the bottom sixteenth of its cell. */
export const PRESSURE_PLATE_SHAPE: AABB = { ...FULL_BLOCK_SHAPE, maxY: PositionAxis(ONE_SIXTEENTH) }

/** A cactus: a full-height block inset one sixteenth on both horizontal axes. */
export const CACTUS_SHAPE: AABB = {
  ...FULL_BLOCK_SHAPE,
  maxX: PositionAxis(FIFTEEN_SIXTEENTHS),
  maxZ: PositionAxis(FIFTEEN_SIXTEENTHS),
  minX: PositionAxis(ONE_SIXTEENTH),
  minZ: PositionAxis(ONE_SIXTEENTH),
}

export const COLLISION_SHAPE_AABBS: Readonly<Record<CollisionShape, AABB | null>> = {
  cactus: CACTUS_SHAPE,
  full: FULL_BLOCK_SHAPE,
  none: null,
  pressurePlate: PRESSURE_PLATE_SHAPE,
  slab: SLAB_SHAPE,
}
