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
 *
 * Shape narrow-phase (turning a candidate cell into an exact entry point) is
 * split out into `dda-shapes.ts`; this file is the grid walk and its public
 * API.
 */
import { type AxisCrossing, type RaycastShapeAt, shapeHitAt } from './dda-shapes.js'
import { BlockAxis, type BlockFace, type Position, PositionAxis, position } from '@nerima-games/mc-kernel'
import { Brand, Option, Result } from 'effect'
import { BlockLength } from './physical-units.js'

export type { RaycastShapeAt } from './dda-shapes.js'

export type VoxelHit = {
  /** Integer cell coordinates of the block that was hit. */
  readonly bx: BlockAxis
  readonly by: BlockAxis
  readonly bz: BlockAxis
  /** Unit normal of the face the ray entered through. Points back at the ray. */
  readonly normal: Position
  /** Canonical Minecraft face the ray entered through. */
  readonly face: BlockFace
  /** Distance from the origin along the normalised direction, in blocks. */
  readonly distance: BlockLength
  /** The exact point on the entered face. */
  readonly point: Position
}

/** Asked once per candidate cell. Physics never sees a block id. */
export type IsTargetable = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => boolean

const EPSILON = 1e-12

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
const positionResult = (x: number, y: number, z: number) =>
  Result.map(
    Result.all([PositionAxis.result(x), PositionAxis.result(y), PositionAxis.result(z)]),
    ([validX, validY, validZ]) => position(validX, validY, validZ),
  )

const voxelHitResult = (
  bx: BlockAxis,
  by: BlockAxis,
  bz: BlockAxis,
  distance: BlockLength,
  face: BlockFace,
  normal: Position,
  point: Result.Result<Position, Brand.BrandError>,
): Result.Result<Option.Option<VoxelHit>, Brand.BrandError> =>
  Result.map(point, (value) => Option.some({ bx, by, bz, distance, face, normal, point: value }))

export const voxelRaycast = (
  origin: Position,
  direction: Position,
  maxDistance: BlockLength,
  isTargetable: IsTargetable,
  shapeAt?: RaycastShapeAt,
): Result.Result<Option.Option<VoxelHit>, Brand.BrandError | RangeError> => {
  const checkedDistance = BlockLength.result(maxDistance)
  if (Result.isFailure(checkedDistance)) {
    return Result.fail(checkedDistance.failure)
  }
  if (!(checkedDistance.success > 0)) {
    return Result.succeed(Option.none())
  }

  const checkedOrigin = Result.all([
    PositionAxis.result(origin.x),
    PositionAxis.result(origin.y),
    PositionAxis.result(origin.z),
  ])
  if (Result.isFailure(checkedOrigin)) {
    return Result.fail(checkedOrigin.failure)
  }
  const originPosition = position(...checkedOrigin.success)

  const checkedDirection = Result.all([
    PositionAxis.result(direction.x),
    PositionAxis.result(direction.y),
    PositionAxis.result(direction.z),
  ])
  if (Result.isFailure(checkedDirection)) {
    return Result.fail(checkedDirection.failure)
  }
  const directionPosition = position(...checkedDirection.success)

  const length = Math.hypot(directionPosition.x, directionPosition.y, directionPosition.z)
  if (!Number.isFinite(length) || length < EPSILON) {
    return Result.succeed(Option.none())
  }

  return Result.flatMap(
    positionResult(directionPosition.x / length, directionPosition.y / length, directionPosition.z / length),
    (unitDirection) => {
      const dx = unitDirection.x, dy = unitDirection.y, dz = unitDirection.z

      const initialCells = Result.all([
        BlockAxis.result(Math.floor(originPosition.x)),
        BlockAxis.result(Math.floor(originPosition.y)),
        BlockAxis.result(Math.floor(originPosition.z)),
      ])
      if (Result.isFailure(initialCells)) {
        return Result.fail(initialCells.failure)
      }
      let [cellX, cellY, cellZ] = initialCells.success

      const stepX = stepSign(dx), stepY = stepSign(dy), stepZ = stepSign(dz)
      const tDeltaX = axisTDelta(stepX, dx), tDeltaY = axisTDelta(stepY, dy), tDeltaZ = axisTDelta(stepZ, dz)
      let tMaxX = firstCrossingT(stepX, cellX, originPosition.x, tDeltaX)
      let tMaxY = firstCrossingT(stepY, cellY, originPosition.y, tDeltaY)
      let tMaxZ = firstCrossingT(stepZ, cellZ, originPosition.z, tDeltaZ)
      const maxSteps = Math.ceil(checkedDistance.success * (Math.abs(dx) + Math.abs(dy) + Math.abs(dz))) + STEP_BOUND_MARGIN

      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
        let crossing: AxisCrossing
        if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
          const nextCell = BlockAxis.result(cellX + stepX)
          if (Result.isFailure(nextCell)) {
            return Result.fail(nextCell.failure)
          }
          cellX = nextCell.success
          crossing = { face: crossingFace(stepX, 'west', 'east'), normalX: -stepX, normalY: 0, normalZ: 0, travelled: tMaxX }
          tMaxX += tDeltaX
        } else if (tMaxY <= tMaxZ) {
          const nextCell = BlockAxis.result(cellY + stepY)
          if (Result.isFailure(nextCell)) {
            return Result.fail(nextCell.failure)
          }
          cellY = nextCell.success
          crossing = { face: crossingFace(stepY, 'down', 'up'), normalX: 0, normalY: -stepY, normalZ: 0, travelled: tMaxY }
          tMaxY += tDeltaY
        } else {
          const nextCell = BlockAxis.result(cellZ + stepZ)
          if (Result.isFailure(nextCell)) {
            return Result.fail(nextCell.failure)
          }
          cellZ = nextCell.success
          crossing = { face: crossingFace(stepZ, 'north', 'south'), normalX: 0, normalY: 0, normalZ: -stepZ, travelled: tMaxZ }
          tMaxZ += tDeltaZ
        }

        if (crossing.travelled > checkedDistance.success) {
          return Result.succeed(Option.none())
        }
        if (isTargetable(cellX, cellY, cellZ)) {
          const shapeHit = shapeHitAt(originPosition, unitDirection, cellX, cellY, cellZ, checkedDistance.success, shapeAt, crossing)
          if (Result.isFailure(shapeHit)) {
            return Result.fail(shapeHit.failure)
          }
          if (shapeHit.success !== null && shapeHit.success.distance <= checkedDistance.success) {
            const hit = shapeHit.success
            const point = positionResult(
              originPosition.x + dx * hit.distance,
              originPosition.y + dy * hit.distance,
              originPosition.z + dz * hit.distance,
            )
            return voxelHitResult(cellX, cellY, cellZ, hit.distance, hit.face, hit.normal, point)
          }
        }
        /* v8 ignore next */
      }

      /* v8 ignore start */
      /*
       * The step bound remains the L1 ray-distance bound plus its entry-cell margin.
       * Coordinate or length brand failures are returned before constructing a hit.
       */
      return Result.succeed(Option.none())
      /* v8 ignore stop */
      /* v8 ignore next */
    },
  )
}
