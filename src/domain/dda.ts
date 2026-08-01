/**
 * Voxel traversal (Amanatides & Woo), for block targeting.
 *
 * FIRST CUT (叩き台).
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
import type { BlockFace } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import type { Vec3 } from './coordinates'

export type VoxelHit = {
  /** Integer cell coordinates of the block that was hit. */
  readonly bx: number
  readonly by: number
  readonly bz: number
  /** Unit normal of the face the ray entered through. Points back at the ray. */
  readonly normal: Vec3
  /** Canonical Minecraft face the ray entered through. */
  readonly face: BlockFace
  /** Distance from the origin along the normalised direction, in blocks. */
  readonly distance: number
  /** The exact point on the entered face. */
  readonly point: Vec3
}

/** Asked once per candidate cell. Physics never sees a block id. */
export type IsTargetable = (bx: number, by: number, bz: number) => boolean

const EPSILON = 1e-12

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
 * whole advantage is that each step is a comparison and an add.
 */
export const voxelRaycast = (
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  isTargetable: IsTargetable,
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

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0

  // Distance along the ray between successive boundary crossings, per axis.
  // An axis the ray does not move along never crosses: Infinity, so its tMax
  // never wins the three-way comparison below.
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx)
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy)
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz)

  // Distance to the FIRST crossing on each axis.
  let tMaxX = stepX === 0 ? Infinity : (stepX > 0 ? cellX + 1 - origin.x : origin.x - cellX) * tDeltaX
  let tMaxY = stepY === 0 ? Infinity : (stepY > 0 ? cellY + 1 - origin.y : origin.y - cellY) * tDeltaY
  let tMaxZ = stepZ === 0 ? Infinity : (stepZ > 0 ? cellZ + 1 - origin.z : origin.z - cellZ) * tDeltaZ

  // The ray crosses at most maxDistance/tDelta boundaries per axis. Summing
  // over the axes gives the L1 bound; +3 covers the entry cell and rounding.
  const maxSteps = Math.ceil(maxDistance * (Math.abs(dx) + Math.abs(dy) + Math.abs(dz))) + 3

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    let travelled: number
    let normalX = 0
    let normalY = 0
    let normalZ = 0
    let face: BlockFace

    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      travelled = tMaxX
      cellX += stepX
      tMaxX += tDeltaX
      normalX = -stepX
      face = stepX > 0 ? 'west' : 'east'
    } else if (tMaxY <= tMaxZ) {
      travelled = tMaxY
      cellY += stepY
      tMaxY += tDeltaY
      normalY = -stepY
      face = stepY > 0 ? 'down' : 'up'
    } else {
      travelled = tMaxZ
      cellZ += stepZ
      tMaxZ += tDeltaZ
      normalZ = -stepZ
      face = stepZ > 0 ? 'north' : 'south'
    }

    if (travelled > maxDistance) {
      return Option.none()
    }
    if (!isTargetable(cellX, cellY, cellZ)) {
      continue
    }

    return Option.some({
      bx: cellX,
      by: cellY,
      bz: cellZ,
      normal: { x: normalX, y: normalY, z: normalZ },
      face,
      distance: travelled,
      point: {
        x: origin.x + dx * travelled,
        y: origin.y + dy * travelled,
        z: origin.z + dz * travelled,
      },
    })
  }

  return Option.none()
}
