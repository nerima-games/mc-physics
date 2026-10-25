/**
 * FR-011: the geometry of a moving piston-arm block AABB pushing a
 * stationary entity AABB out of its way.
 *
 * Every other resolver in this package MAINTAINS non-embedding: it assumes
 * the precondition already holds and only corrects drift
 * (docs/design-notes.md P-9-7 — the resolver "resolves" what should already
 * be true, it does not establish it from an arbitrary starting overlap). A
 * piston is the one geometry in this domain that is allowed to walk a moving
 * block straight into a stationary entity — the entity never moved, the
 * block did, and the two are now overlapping by construction. This function
 * is the exception that ESTABLISHES non-embedding rather than preserving it.
 *
 * Which block moves, whether the piston is powered, and rewriting block
 * state all belong to mx-redstone/mc-sim. This module answers one geometric
 * question only: given where a block was and how far it is moving this
 * step, how far must a stationary entity move to end up clear of it, and is
 * there room to do so.
 */
import { type AABB, CONTACT_EPSILON, collidesWith } from './coordinates.js'
import { BlockLength, type BlockVector, blockVectorResult } from './physical-units.js'
import { Brand, Result } from 'effect'
import { PositionAxis } from '@nerima-games/mc-kernel'

/** The piston's extension axis. A Java piston arm moves one block along exactly one axis per stroke. */
export type PistonAxis = 'x' | 'y' | 'z'

/** A moving block AABB: where it was before this step, and the signed displacement it makes this step. */
export type PistonBlockMove = Readonly<{
  readonly axis: PistonAxis
  readonly before: AABB
  readonly distance: BlockLength
}>

/**
 * The result of pushing one entity clear of a moving block.
 *
 * `displacement` carries a nonzero component on `axis` only: Java pistons
 * push along their extension axis and never slide an entity sideways.
 * `crushed` is true when an obstacle on the far side leaves no room for the
 * full push, in which case `displacement` is the partial push up to that
 * obstacle rather than the full clearing distance.
 */
export type PistonExtrusion = Readonly<{
  readonly displacement: BlockVector
  readonly crushed: boolean
}>

const ZERO_EXTRUSION: PistonExtrusion = {
  crushed: false,
  displacement: { x: BlockLength(0), y: BlockLength(0), z: BlockLength(0) },
}

const OTHER_AXES: Readonly<Record<PistonAxis, readonly [PistonAxis, PistonAxis]>> = {
  x: ['y', 'z'],
  y: ['x', 'z'],
  z: ['x', 'y'],
}

const axisMin = (box: AABB, axis: PistonAxis): number => {
  if (axis === 'x') {
    return box.minX
  }
  if (axis === 'y') {
    return box.minY
  }
  return box.minZ
}

const axisMax = (box: AABB, axis: PistonAxis): number => {
  if (axis === 'x') {
    return box.maxX
  }
  if (axis === 'y') {
    return box.maxY
  }
  return box.maxZ
}

const aabbResult = (box: AABB): Result.Result<AABB, Brand.BrandError> => {
  const { minX, minY, minZ, maxX, maxY, maxZ } = box
  return Result.map(
    Result.all([
      PositionAxis.result(minX),
      PositionAxis.result(minY),
      PositionAxis.result(minZ),
      PositionAxis.result(maxX),
      PositionAxis.result(maxY),
      PositionAxis.result(maxZ),
    ]),
    ([validMinX, validMinY, validMinZ, validMaxX, validMaxY, validMaxZ]): AABB => ({
      maxX: validMaxX,
      maxY: validMaxY,
      maxZ: validMaxZ,
      minX: validMinX,
      minY: validMinY,
      minZ: validMinZ,
    }),
  )
}

const translatedOnAxis = (
  box: AABB,
  axis: PistonAxis,
  delta: BlockLength,
): Result.Result<AABB, Brand.BrandError> => {
  if (axis === 'x') {
    return Result.map(
      Result.all([PositionAxis.result(box.minX + delta), PositionAxis.result(box.maxX + delta)]),
      ([minX, maxX]): AABB => ({ ...box, maxX, minX }),
    )
  }
  if (axis === 'y') {
    return Result.map(
      Result.all([PositionAxis.result(box.minY + delta), PositionAxis.result(box.maxY + delta)]),
      ([minY, maxY]): AABB => ({ ...box, maxY, minY }),
    )
  }
  return Result.map(
    Result.all([PositionAxis.result(box.minZ + delta), PositionAxis.result(box.maxZ + delta)]),
    ([minZ, maxZ]): AABB => ({ ...box, maxZ, minZ }),
  )
}

const displacementOn = (axis: PistonAxis, amount: BlockLength) => {
  if (axis === 'x') {
    return blockVectorResult(amount, 0, 0)
  }
  if (axis === 'y') {
    return blockVectorResult(0, amount, 0)
  }
  return blockVectorResult(0, 0, amount)
}

/**
 * Signed distance to move `entity` on `axis` so its near face lands exactly
 * on `after`'s far face (in the direction of travel given by `sign`).
 *
 * Deliberately not the axis-wise penetration depth: a small entity fully
 * swallowed within the moved block's span has a penetration depth equal to
 * its own width, which is not enough to clear it. Using the moved block's
 * leading face directly instead of the overlap depth is what keeps this
 * correct regardless of how much of `entity` the moved block covers.
 */
const pushDistance = (
  entity: AABB,
  after: AABB,
  axis: PistonAxis,
  sign: number,
): Result.Result<BlockLength, Brand.BrandError> => {
  if (sign > 0) {
    return BlockLength.result(axisMax(after, axis) - axisMin(entity, axis))
  }
  return BlockLength.result(axisMin(after, axis) - axisMax(entity, axis))
}

/**
 * Room for `entity`'s leading face to advance in `sign` direction on `axis`
 * before it reaches `obstacle`. Infinite when `obstacle` does not share the
 * entity's cross-section on the two axes perpendicular to the push — it is
 * not in the way regardless of where it sits on the push axis.
 */
const roomBefore = (entity: AABB, obstacle: AABB, axis: PistonAxis, sign: number): number => {
  const [firstCrossAxis, secondCrossAxis] = OTHER_AXES[axis]
  const inCrossSection =
    axisMin(entity, firstCrossAxis) < axisMax(obstacle, firstCrossAxis) &&
    axisMax(entity, firstCrossAxis) > axisMin(obstacle, firstCrossAxis) &&
    axisMin(entity, secondCrossAxis) < axisMax(obstacle, secondCrossAxis) &&
    axisMax(entity, secondCrossAxis) > axisMin(obstacle, secondCrossAxis)
  if (!inCrossSection) {
    return Number.POSITIVE_INFINITY
  }
  if (sign > 0) {
    return axisMin(obstacle, axis) - axisMax(entity, axis)
  }
  return axisMin(entity, axis) - axisMax(obstacle, axis)
}

/**
 * The displacement a moving block AABB imposes on a stationary entity AABB,
 * and whether an obstacle on the far side leaves no room for it.
 *
 * Zero movement (`distance === 0`) is never a push, even if `before` already
 * overlaps `entity` — a static overlap is the general resolver's
 * precondition to maintain, not something this exception establishes. Only
 * actual block displacement triggers a push.
 *
 * `obstacles` are candidate blockers on the far side of the push; supplying
 * none means the push is assumed to have unlimited room.
 */
export const pistonExtrusion = (
  entity: AABB,
  move: PistonBlockMove,
  obstacles: ReadonlyArray<AABB> = [],
): Result.Result<PistonExtrusion, Brand.BrandError> => {
  const { axis } = move
  const distance = BlockLength.result(move.distance)
  if (Result.isFailure(distance)) {
    return Result.fail(distance.failure)
  }
  const checkedBoxes = Result.all([
    aabbResult(entity),
    aabbResult(move.before),
    Result.all(obstacles.map(aabbResult)),
  ])
  if (Result.isFailure(checkedBoxes)) {
    return Result.fail(checkedBoxes.failure)
  }
  const [checkedEntity, before, checkedObstacles] = checkedBoxes.success
  if (distance.success === 0) {
    return Result.succeed(ZERO_EXTRUSION)
  }

  const after = translatedOnAxis(before, axis, distance.success)
  if (Result.isFailure(after)) {
    return Result.fail(after.failure)
  }
  if (!collidesWith(checkedEntity, after.success)) {
    return Result.succeed(ZERO_EXTRUSION)
  }

  const sign = Math.sign(distance.success)
  const neededResult = pushDistance(checkedEntity, after.success, axis, sign)
  if (Result.isFailure(neededResult)) {
    return Result.fail(neededResult.failure)
  }
  const needed = Math.abs(neededResult.success)

  let room = Number.POSITIVE_INFINITY
  for (const obstacle of checkedObstacles) {
    room = Math.min(room, roomBefore(checkedEntity, obstacle, axis, sign))
  }
  room = Math.max(0, room)

  const actual = Math.min(needed, room)
  const actualDistance = BlockLength.result(actual * sign)
  return Result.flatMap(actualDistance, (pushAmount) => {
    const displacement = displacementOn(axis, pushAmount)
    return Result.map(displacement, (value): PistonExtrusion => ({
      crushed: actual + CONTACT_EPSILON < needed,
      displacement: value,
    }))
  })
}
