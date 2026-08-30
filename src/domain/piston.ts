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
 * state all belong to mc-redstone/mc-sim. This module answers one geometric
 * question only: given where a block was and how far it is moving this
 * step, how far must a stationary entity move to end up clear of it, and is
 * there room to do so.
 */
import { type AABB, CONTACT_EPSILON, collidesWith } from './coordinates.js'
import type { Position } from '@nerima-games/mc-kernel'

/** The piston's extension axis. A Java piston arm moves one block along exactly one axis per stroke. */
export type PistonAxis = 'x' | 'y' | 'z'

/** A moving block AABB: where it was before this step, and the signed displacement it makes this step. */
export type PistonBlockMove = Readonly<{
  readonly axis: PistonAxis
  readonly before: AABB
  readonly distance: number
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
  readonly displacement: Position
  readonly crushed: boolean
}>

const ZERO_EXTRUSION: PistonExtrusion = { crushed: false, displacement: { x: 0, y: 0, z: 0 } }

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

const translatedOnAxis = (box: AABB, axis: PistonAxis, delta: number): AABB => {
  if (axis === 'x') {
    return { ...box, maxX: box.maxX + delta, minX: box.minX + delta }
  }
  if (axis === 'y') {
    return { ...box, maxY: box.maxY + delta, minY: box.minY + delta }
  }
  return { ...box, maxZ: box.maxZ + delta, minZ: box.minZ + delta }
}

const displacementOn = (axis: PistonAxis, amount: number): Position => {
  if (axis === 'x') {
    return { x: amount, y: 0, z: 0 }
  }
  if (axis === 'y') {
    return { x: 0, y: amount, z: 0 }
  }
  return { x: 0, y: 0, z: amount }
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
const pushDistance = (entity: AABB, after: AABB, axis: PistonAxis, sign: number): number => {
  if (sign > 0) {
    return axisMax(after, axis) - axisMin(entity, axis)
  }
  return axisMin(after, axis) - axisMax(entity, axis)
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
): PistonExtrusion => {
  if (move.distance === 0) {
    return ZERO_EXTRUSION
  }

  const after = translatedOnAxis(move.before, move.axis, move.distance)
  if (!collidesWith(entity, after)) {
    return ZERO_EXTRUSION
  }

  const sign = Math.sign(move.distance)
  const needed = Math.abs(pushDistance(entity, after, move.axis, sign))

  let room = Number.POSITIVE_INFINITY
  for (const obstacle of obstacles) {
    room = Math.min(room, roomBefore(entity, obstacle, move.axis, sign))
  }
  room = Math.max(0, room)

  const actual = Math.min(needed, room)
  const crushed = actual + CONTACT_EPSILON < needed

  return { crushed, displacement: displacementOn(move.axis, actual * sign) }
}
