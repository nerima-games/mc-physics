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
import { BlockAxis, type BlockFace, type Position, PositionAxis, position } from '@nerima-games/mc-kernel'
import { Brand, Result } from 'effect'
import { BlockLength } from './physical-units.js'
import { FULL_BLOCK_SHAPE } from './shape-data.js'

/**
 * The targetable block's one or more AABBs within its own cell. `null` means a
 * full cube, while an empty array means that the cell has no collision shape.
 * Invalid or out-of-cell shapes are ignored rather than extending the raycast
 * into a neighbouring voxel owned by another DDA step.
 */
export type RaycastShapeAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => BlockShape | null

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
  readonly distance: BlockLength
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

const axisNormal = (axis: 'x' | 'y' | 'z', magnitude: -1 | 1): Position => {
  const zero = PositionAxis(0)
  const signed = PositionAxis(magnitude)
  if (axis === 'x') {
    return position(signed, zero, zero)
  }
  if (axis === 'y') {
    return position(zero, signed, zero)
  }
  return position(zero, zero, signed)
}

/** Ray/AABB slab intersection. Axis order is the deterministic X -> Y -> Z tie-break. */
const intersectShape = (
  origin: Position,
  direction: Position,
  box: AABB,
): Result.Result<ShapeHit | null, Brand.BrandError> => {
  let nearDistance = Number.NEGATIVE_INFINITY
  let farDistance = Number.POSITIVE_INFINITY
  let face: BlockFace = 'west'
  let normal: Position = axisNormal('x', -1)

  for (const slab of axisSlabs(origin, direction, box)) {
    if (slab.direction === 0) {
      if (slab.origin < slab.min || slab.origin > slab.max) {
        return Result.succeed(null)
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
        return Result.succeed(null)
      }
    }
  }

  return Result.map(BlockLength.result(nearDistance), (distance): ShapeHit => ({ distance, face, normal }))
}

const positionResult = (x: number, y: number, z: number) =>
  Result.map(
    Result.all([PositionAxis.result(x), PositionAxis.result(y), PositionAxis.result(z)]),
    ([validX, validY, validZ]) => position(validX, validY, validZ),
  )

const crossingShapeHit = (crossing: AxisCrossing): Result.Result<ShapeHit, Brand.BrandError> => {
  const distance = BlockLength.result(crossing.travelled)
  if (Result.isFailure(distance)) {
    return Result.fail(distance.failure)
  }
  const normal = positionResult(crossing.normalX, crossing.normalY, crossing.normalZ)
  return Result.map(normal, (value): ShapeHit => ({ distance: distance.success, face: crossing.face, normal: value }))
}

const nearestShapeHit = (
  origin: Position,
  direction: Position,
  cellX: BlockAxis,
  cellY: BlockAxis,
  cellZ: BlockAxis,
  shapes: ReadonlyArray<AABB>,
  maxDistance: BlockLength,
): Result.Result<ShapeHit | null, Brand.BrandError | RangeError> => {
  let nearest: ShapeHit | null = null
  for (const localShape of shapes) {
    if (isCellShape(localShape)) {
      const box = blockAABB(cellX, cellY, cellZ, localShape)
      if (Result.isFailure(box)) {
        return Result.fail(box.failure)
      }
      const candidate = intersectShape(origin, direction, box.success)
      if (Result.isFailure(candidate)) {
        return Result.fail(candidate.failure)
      }
      const candidateHit = candidate.success
      if (
        candidateHit !== null &&
        candidateHit.distance <= maxDistance &&
        (nearest === null || candidateHit.distance < nearest.distance)
      ) {
        nearest = candidateHit
      }
    }
  }
  return Result.succeed(nearest)
}

export const shapeHitAt = (
  origin: Position,
  direction: Position,
  cellX: BlockAxis,
  cellY: BlockAxis,
  cellZ: BlockAxis,
  maxDistance: BlockLength,
  shapeAt: RaycastShapeAt | undefined,
  crossing: AxisCrossing,
): Result.Result<ShapeHit | null, Brand.BrandError | RangeError> => {
  if (typeof shapeAt === 'undefined') {
    const hit = crossingShapeHit(crossing)
    return Result.map(hit, (value) => value)
  }
  const shape = shapeAt(cellX, cellY, cellZ) ?? FULL_BLOCK_SHAPE
  return nearestShapeHit(origin, direction, cellX, cellY, cellZ, aabbsOfBlockShape(shape), maxDistance)
}
