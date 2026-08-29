/**
 * Voxel traversal (Amanatides & Woo), for block targeting.
 *
 * ---------------------------------------------------------------------------
 * Why a DDA and not a mesh raycast
 * ---------------------------------------------------------------------------
 *
 * A mesh raycaster brute-forces every triangle of every chunk mesh whose bounds
 * the ray touches. A DDA walks the grid and touches at most a handful of cells,
 * against raw block data, with no geometry involved at all. plan.md §3.4 quotes
 * 2.3 ms -> 0.09 ms (~25x) for the switch.
 *
 * HONESTY NOTE ON THAT FIGURE: it appears in the reference repository's prose
 * only (`docs/reference/shipping-readiness-2026-07-10.md:50`). There is no
 * committed benchmark, no `.bench.ts` and no profiler output backing it. The
 * reference's own code comment
 * (`packages/world/domain/voxel-raycast.ts:3-6`) makes the weaker and more
 * defensible claim that the mesh path was "~16% of main thread when facing
 * terrain". Treat 25x as unreproduced. The ALGORITHMIC argument — O(cells
 * crossed) versus O(triangles in range) — stands on its own and is the actual
 * reason to do this.
 *
 * ---------------------------------------------------------------------------
 * Two corrections to the reference
 * ---------------------------------------------------------------------------
 *
 * 1. The reference's step bound comment says "ceil(maxDistance * sqrt(3)) + 1"
 *    while its code computes `maxDistance * (|dx| + |dy| + |dz|) + 3`. Those are
 *    different: the second is the L1 norm, which for a unit direction is at most
 *    sqrt(3) — so the comment is a loose bound on the code rather than a
 *    description of it. The code is right; the comment is not. This file uses
 *    the L1 form and says so.
 * 2. The reference does not normalise the direction, so `maxDistance` is
 *    measured in units of the caller's direction vector rather than in blocks.
 *    This one normalises, so `maxDistance` means blocks.
 *
 * See docs/design-notes.md, regressions `physics-dda-skips-origin-cell` and
 * `physics-dda-respects-max-distance`.
 */
import {
  type AABB,
  type BlockShape,
  aabbsOfBlockShape,
  blockAABB,
} from './coordinates'
import { type BlockFace, type Position } from '@nerima-games/mc-kernel'
import { FULL_BLOCK_SHAPE } from './shape-data'
import { Option } from 'effect'

export type VoxelHit = {
  /** Integer cell coordinates of the block that was hit. */
  readonly bx: number
  readonly by: number
  readonly bz: number
  /** Unit normal of the face the ray entered through. Points back at the ray. */
  readonly normal: Position
  /** Canonical Minecraft face the ray entered through. */
  readonly face: BlockFace
  /** Distance from the origin along the normalised direction, in blocks. */
  readonly distance: number
  /** The exact point on the entered face. */
  readonly point: Position
}

/** Asked once per candidate cell. Physics never sees a block id. */
export type IsTargetable = (bx: number, by: number, bz: number) => boolean

/**
 * The targetable block's one or more AABBs within its own cell. `null` means a
 * full cube, while an empty array means that the cell has no collision shape.
 * Invalid or out-of-cell shapes are ignored rather than extending the raycast
 * into a neighbouring voxel owned by another DDA step.
 */
export type RaycastShapeAt = (bx: number, by: number, bz: number) => BlockShape | null

const EPSILON = 1e-12

type ShapeHit = Pick<VoxelHit, 'distance' | 'face' | 'normal'>

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

/* eslint-disable complexity, max-statements, no-magic-numbers, no-ternary, no-nested-ternary, no-continue, curly */
/** Ray/AABB slab intersection. Axis order is the deterministic X -> Y -> Z tie-break. */
const intersectShape = (origin: Position, direction: Position, box: AABB): ShapeHit | null => {
  let nearDistance = -Infinity
  let farDistance = Infinity
  let face: BlockFace = 'west'
  let normalX = -1
  let normalY = 0
  let normalZ = 0

  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const axisOrigin = axisIndex === 0 ? origin.x : axisIndex === 1 ? origin.y : origin.z
    const axisDirection = axisIndex === 0 ? direction.x : axisIndex === 1 ? direction.y : direction.z
    const min = axisIndex === 0 ? box.minX : axisIndex === 1 ? box.minY : box.minZ
    const max = axisIndex === 0 ? box.maxX : axisIndex === 1 ? box.maxY : box.maxZ
    if (axisDirection === 0) {
      if (axisOrigin < min || axisOrigin > max) return null
      continue
    }
    const lowDistance = (min - axisOrigin) / axisDirection
    const highDistance = (max - axisOrigin) / axisDirection
    const enteringDistance = Math.min(lowDistance, highDistance)
    const leavingDistance = Math.max(lowDistance, highDistance)
    if (enteringDistance > nearDistance) {
      nearDistance = enteringDistance
      const entersLowFace = axisDirection > 0
      if (axisIndex === 0) {
        face = entersLowFace ? 'west' : 'east'
        normalX = entersLowFace ? -1 : 1
        normalY = 0
        normalZ = 0
      } else if (axisIndex === 1) {
        face = entersLowFace ? 'down' : 'up'
        normalX = 0
        normalY = entersLowFace ? -1 : 1
        normalZ = 0
      } else {
        face = entersLowFace ? 'north' : 'south'
        normalX = 0
        normalY = 0
        normalZ = entersLowFace ? -1 : 1
      }
    }
    farDistance = Math.min(farDistance, leavingDistance)
    if (nearDistance > farDistance) return null
  }

  return { distance: nearDistance, face, normal: { x: normalX, y: normalY, z: normalZ } }
}
/* eslint-enable complexity, max-statements, no-magic-numbers, no-ternary, no-nested-ternary, no-continue, curly */

/** Which way (if any) the DDA steps on one axis, from that axis's normalised ray-direction component. */
const stepSign = (component: number): -1 | 0 | 1 => {
  if (component > 0) {
    return 1
  }
  if (component < 0) {
    return -1
  }
  return 0
}

/**
 * Ray-parameter distance between successive grid-boundary crossings on one
 * axis. Infinity if the ray never moves on this axis, so it never wins the
 * three-way comparison in the walk loop below.
 */
const axisTDelta = (step: number, component: number): number => {
  if (step === 0) {
    return Infinity
  }
  return Math.abs(1 / component)
}

/** Ray-parameter distance to the FIRST grid-boundary crossing on one axis. */
const firstCrossingT = (step: number, cell: number, originComponent: number, tDelta: number): number => {
  if (step === 0) {
    return Infinity
  }
  if (step > 0) {
    return (cell + 1 - originComponent) * tDelta
  }
  return (originComponent - cell) * tDelta
}

/** Which cube face a step in the given direction along one axis enters through. */
const crossingFace = (step: number, positiveFace: BlockFace, negativeFace: BlockFace): BlockFace => {
  if (step > 0) {
    return positiveFace
  }
  return negativeFace
}

/** One grid-boundary crossing: how far along the ray, which face, and the entered face's unit normal. */
type AxisCrossing = {
  readonly travelled: number
  readonly face: BlockFace
  readonly normalX: number
  readonly normalY: number
  readonly normalZ: number
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

const shapeHitAt = (
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

/** Setup-phase-only: run once per `voxelRaycast` call, never inside the walk loop. */
const STEP_BOUND_MARGIN = 3

/**
 * Walk the voxel grid from `origin` along `direction` and return the first
 * targetable cell, or `Option.none()`.
 *
 * THE ORIGIN CELL IS NEVER RETURNED. The camera is inside a cell — usually air,
 * but inside a wall when clipping or spectating — and returning it would let a
 * player mine the block their head is in. The reference has the same rule and a
 * test for it (`packages/world/domain/voxel-raycast.test.ts`).
 *
 * `let` + `for` throughout: this is the canonical incremental DDA, and its
 * whole advantage is that each step is a comparison and an add. The per-step
 * axis walk is deliberately NOT split into a helper function call: that would
 * reintroduce a call per grid cell crossed, exactly the cost this loop shape
 * exists to avoid.
 */
export const voxelRaycast = (
  origin: Position,
  direction: Position,
  maxDistance: number,
  isTargetable: IsTargetable,
  shapeAt?: RaycastShapeAt,
): Option.Option<VoxelHit> => {
  const length = Math.hypot(direction.x, direction.y, direction.z)
  if (!Number.isFinite(length) || length < EPSILON || !(maxDistance > 0)) {
    return Option.none()
  }
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) {
    return Option.none()
  }

  const dx = direction.x / length
  const dy = direction.y / length
  const dz = direction.z / length

  let cellX = Math.floor(origin.x)
  let cellY = Math.floor(origin.y)
  let cellZ = Math.floor(origin.z)

  const stepX = stepSign(dx)
  const stepY = stepSign(dy)
  const stepZ = stepSign(dz)

  /*
   * Distance along the ray between successive boundary crossings, per axis.
   * An axis the ray does not move along never crosses: Infinity, so its tMax
   * never wins the three-way comparison below.
   */
  const tDeltaX = axisTDelta(stepX, dx)
  const tDeltaY = axisTDelta(stepY, dy)
  const tDeltaZ = axisTDelta(stepZ, dz)

  // Distance to the FIRST crossing on each axis.
  let tMaxX = firstCrossingT(stepX, cellX, origin.x, tDeltaX)
  let tMaxY = firstCrossingT(stepY, cellY, origin.y, tDeltaY)
  let tMaxZ = firstCrossingT(stepZ, cellZ, origin.z, tDeltaZ)

  /*
   * The ray crosses at most maxDistance/tDelta boundaries per axis. Summing
   * over the axes gives the L1 bound; STEP_BOUND_MARGIN covers the entry cell
   * and rounding.
   */
  const maxSteps = Math.ceil(maxDistance * (Math.abs(dx) + Math.abs(dy) + Math.abs(dz))) + STEP_BOUND_MARGIN

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    let crossing: AxisCrossing
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      crossing = { face: crossingFace(stepX, 'west', 'east'), normalX: -stepX, normalY: 0, normalZ: 0, travelled: tMaxX }
      cellX += stepX
      tMaxX += tDeltaX
    } else if (tMaxY <= tMaxZ) {
      crossing = { face: crossingFace(stepY, 'down', 'up'), normalX: 0, normalY: -stepY, normalZ: 0, travelled: tMaxY }
      cellY += stepY
      tMaxY += tDeltaY
    } else {
      crossing = { face: crossingFace(stepZ, 'north', 'south'), normalX: 0, normalY: 0, normalZ: -stepZ, travelled: tMaxZ }
      cellZ += stepZ
      tMaxZ += tDeltaZ
    }

    if (crossing.travelled > maxDistance) {
      return Option.none()
    }
    if (isTargetable(cellX, cellY, cellZ)) {
      const shapeHit = shapeHitAt(origin, { x: dx, y: dy, z: dz }, cellX, cellY, cellZ, maxDistance, shapeAt, crossing)
      if (shapeHit !== null && shapeHit.distance <= maxDistance) {
        return Option.some({
          bx: cellX,
          by: cellY,
          bz: cellZ,
          distance: shapeHit.distance,
          face: shapeHit.face,
          normal: shapeHit.normal,
          point: {
            x: origin.x + dx * shapeHit.distance,
            y: origin.y + dy * shapeHit.distance,
            z: origin.z + dz * shapeHit.distance,
          },
        })
      }
    }
    /* v8 ignore next */
  }

  /* v8 ignore start */
  /*
   * PROOF this is unreachable, not merely untested: `maxSteps` is
   * `ceil(maxDistance * (|dx| + |dy| + |dz|)) + STEP_BOUND_MARGIN` for a unit
   * direction. The number of grid-boundary crossings a straight ray of length
   * `maxDistance` makes is `sum over axes of |floor(end_axis) -
   * floor(start_axis)|`, which is bounded above by `maxDistance * |axis
   * component| + 1` per axis (one crossing per unit travelled, plus at most
   * one more for where the ray starts mid-cell) — summed, that is exactly the
   * L1 term above plus at most 3, which `STEP_BOUND_MARGIN` supplies. So the
   * in-loop `crossing.travelled > maxDistance` check is guaranteed to fire
   * (returning `Option.none()` from inside the loop) at or before the last
   * budgeted step, for every finite `origin`/`direction` this function
   * accepts — both are validated finite above. This fallback exists as a
   * belt-and-suspenders return so the function's type is total even if that
   * bound is ever loosened; it was already documented as the sole
   * unreachable-in-practice line at this repository's coverage-gate rollout
   * (see vitest.config.ts's `thresholds` comment). v8's coverage instrument
   * attributes the enclosing loop's "completed without an early return" edge
   * to this whole trailing region (from the loop's closing brace to the
   * function's), not just the `return` line, so the ignore spans that region.
   */
  return Option.none()
  /* v8 ignore stop */
  /* v8 ignore next */
}
