/**
 * Shape narrow-phase for the voxel DDA (domain/dda.ts): given a candidate
 * cell the grid walk has already stepped into, decide exactly where along
 * the ray it is entered — a full cube, a compound block shape (slab, cactus,
 * pressure plate, ...), or the bare grid-boundary crossing the walk itself
 * computed, when the caller supplies no per-block shape lookup at all.
 */
import {
  type AABB,
  type BlockShape,
  aabbsOfBlockShape,
  blockAABB,
} from './coordinates.js'
import { type BlockFace, type Position } from '@nerima-games/mc-kernel'
import { FULL_BLOCK_SHAPE } from './shape-data.js'

/**
 * The targetable block's one or more AABBs within its own cell. `null` means a
 * full cube, while an empty array means that the cell has no collision shape.
 * Invalid or out-of-cell shapes are ignored rather than extending the raycast
 * into a neighbouring voxel owned by another DDA step.
 */
export type RaycastShapeAt = (bx: number, by: number, bz: number) => BlockShape | null

/**
 * One grid-boundary crossing, as produced by the walk loop in dda.ts: how far
 * along the ray, which face, and the entered face's unit normal. This is the
 * interface between the walk and this narrow phase — used directly as the
 * fallback hit when `shapeAt` is not supplied.
 */
export type AxisCrossing = {
  readonly travelled: number
  readonly face: BlockFace
  readonly normalX: number
  readonly normalY: number
  readonly normalZ: number
}

type ShapeHit = {
  readonly distance: number
  readonly face: BlockFace
  readonly normal: Position
}

const isCellShape = (shape: AABB): boolean =>
  Number.isFinite(shape.minX) &&
  Number.isFinite(shape.minY) &&
  Number.isFinite(shape.minZ) &&
  Number.isFinite(shape.maxX) &&
  Number.isFinite(shape.maxY) &&
  Number.isFinite(shape.maxZ) &&
  shape.minX >= 0 &&
  shape.minY >= 0 &&
  shape.minZ >= 0 &&
  shape.maxX <= 1 &&
  shape.maxY <= 1 &&
  shape.maxZ <= 1 &&
  shape.minX < shape.maxX &&
  shape.minY < shape.maxY &&
  shape.minZ < shape.maxZ

type AxisSlab = {
  readonly axis: 'x' | 'y' | 'z'
  readonly origin: number
  readonly direction: number
  readonly min: number
  readonly max: number
  readonly lowFace: BlockFace
  readonly highFace: BlockFace
}

/** The three axis slabs of a box, built by construction rather than indexed, so no axis selection ever needs a ternary. */
const axisSlabs = (origin: Position, direction: Position, box: AABB): ReadonlyArray<AxisSlab> => [
  { axis: 'x', direction: direction.x, highFace: 'east', lowFace: 'west', max: box.maxX, min: box.minX, origin: origin.x },
  { axis: 'y', direction: direction.y, highFace: 'up', lowFace: 'down', max: box.maxY, min: box.minY, origin: origin.y },
  { axis: 'z', direction: direction.z, highFace: 'south', lowFace: 'north', max: box.maxZ, min: box.minZ, origin: origin.z },
]

const axisNormal = (axis: 'x' | 'y' | 'z', magnitude: number): Position => {
  if (axis === 'x') {
    return { x: magnitude, y: 0, z: 0 }
  }
  if (axis === 'y') {
    return { x: 0, y: magnitude, z: 0 }
  }
  return { x: 0, y: 0, z: magnitude }
}

/** Ray/AABB slab intersection. Axis order is the deterministic X -> Y -> Z tie-break. */
const intersectShape = (origin: Position, direction: Position, box: AABB): ShapeHit | null => {
  let nearDistance = Number.NEGATIVE_INFINITY
  let farDistance = Number.POSITIVE_INFINITY
  let face: BlockFace = 'west'
  let normal: Position = { x: -1, y: 0, z: 0 }

  for (const slab of axisSlabs(origin, direction, box)) {
    if (slab.direction === 0) {
      if (slab.origin < slab.min || slab.origin > slab.max) {
        return null
      }
    } else {
      const lowDistance = (slab.min - slab.origin) / slab.direction
      const highDistance = (slab.max - slab.origin) / slab.direction
      const enteringDistance = Math.min(lowDistance, highDistance)
      const leavingDistance = Math.max(lowDistance, highDistance)
      if (enteringDistance > nearDistance) {
        nearDistance = enteringDistance
        if (slab.direction > 0) {
          face = slab.lowFace
          normal = axisNormal(slab.axis, -1)
        } else {
          face = slab.highFace
          normal = axisNormal(slab.axis, 1)
        }
      }
      farDistance = Math.min(farDistance, leavingDistance)
      if (nearDistance > farDistance) {
        return null
      }
    }
  }

  return { distance: nearDistance, face, normal }
}

const crossingShapeHit = (crossing: AxisCrossing): ShapeHit => ({
  distance: crossing.travelled,
  face: crossing.face,
  normal: { x: crossing.normalX, y: crossing.normalY, z: crossing.normalZ },
})

const nearestShapeHit = (
  origin: Position,
  direction: Position,
  cellX: number,
  cellY: number,
  cellZ: number,
  shapes: ReadonlyArray<AABB>,
  maxDistance: number,
): ShapeHit | null => {
  let nearest: ShapeHit | null = null
  for (const localShape of shapes) {
    if (isCellShape(localShape)) {
      const candidateHit = intersectShape(origin, direction, blockAABB(cellX, cellY, cellZ, localShape))
      if (
        candidateHit !== null &&
        candidateHit.distance <= maxDistance &&
        (nearest === null || candidateHit.distance < nearest.distance)
      ) {
        nearest = candidateHit
      }
    }
  }
  return nearest
}

export const shapeHitAt = (
  origin: Position,
  direction: Position,
  cellX: number,
  cellY: number,
  cellZ: number,
  maxDistance: number,
  shapeAt: RaycastShapeAt | undefined,
  crossing: AxisCrossing,
): ShapeHit | null => {
  if (typeof shapeAt === 'undefined') {
    return crossingShapeHit(crossing)
  }
  const shape = shapeAt(cellX, cellY, cellZ) ?? FULL_BLOCK_SHAPE
  return nearestShapeHit(origin, direction, cellX, cellY, cellZ, aabbsOfBlockShape(shape), maxDistance)
}
