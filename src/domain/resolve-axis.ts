import { type AABB, CONTACT_EPSILON } from './coordinates.js'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import type { ResolveOptions } from './resolve-types.js'
import { forEachCollidingBlock } from './resolve-shapes.js'

export type AxisState = {
  readonly blocked: boolean
  readonly position: number
  readonly velocity: number
  /**
   * Set only when a downward floor impact was reflected by bounciness, so
   * `velocity` points away from the surface it just touched rather than
   * resting on it. `resolveBody` reads this to keep a bounced body from
   * reporting grounded on the frame it leaves the floor.
   */
  readonly bounced?: boolean
}

/** Only a finite value in [0, 1] is a meaningful bounciness; anything else (unset, NaN, negative) means none. */
const clampBounciness = (value: number | undefined): number => {
  const candidate = value ?? Number.NaN
  if (!Number.isFinite(candidate)) {
    return 0
  }
  return Math.min(1, Math.max(0, candidate))
}

export const clampAxis = (
  state: AxisState,
  bodyMin: number,
  bodyMax: number,
  halfExtent: number,
  options: ResolveOptions,
  box: AABB,
  nearFace: (block: AABB) => number,
  farFace: (block: AABB) => number,
): AxisState => {
  if (state.velocity > 0) {
    let face = Number.POSITIVE_INFINITY
    forEachCollidingBlock(options, box, (block) => {
      const candidateFace = nearFace(block)
      if (candidateFace >= bodyMin) {
        face = Math.min(face, candidateFace)
      }
    })
    if (face < Number.POSITIVE_INFINITY) {
      return { blocked: true, position: face - halfExtent, velocity: 0 }
    }
    return state
  }

  if (state.velocity < 0) {
    let face = Number.NEGATIVE_INFINITY
    forEachCollidingBlock(options, box, (block) => {
      const candidateFace = farFace(block)
      if (candidateFace <= bodyMax) {
        face = Math.max(face, candidateFace)
      }
    })
    if (face > Number.NEGATIVE_INFINITY) {
      return { blocked: true, position: face + halfExtent, velocity: 0 }
    }
    return state
  }

  return state
}

export const resolveVertical = (
  options: ResolveOptions,
  box: AABB,
  state: AxisState,
  deltaTime: DeltaTimeSecs,
): AxisState => {
  /*
   * A resting body (velocity exactly 0) sits a contact-epsilon gap above its
   * floor, so no colliding block can satisfy the floor test below:
   * `collidesWith` demands more than CONTACT_EPSILON of overlap while the
   * floor test accepts at most that much reach. Returning early states that
   * invariant instead of hiding it in an unreachable bounce guard (P-6).
   */
  if (state.velocity === 0) {
    return state
  }

  if (state.velocity < 0) {
    const reach = -state.velocity * deltaTime + CONTACT_EPSILON
    let floorTop = Number.NEGATIVE_INFINITY
    /*
     * Cell of whichever block currently holds `floorTop`. Recovered from the
     * block's own AABB rather than threaded through `forEachCollidingBlock`
     * (whose signature is out of scope here): every authored shape's local
     * min lies in [0, 1), so `Math.floor(block.min*)` is exactly the cell.
     */
    let floorBx = 0
    let floorBy = 0
    let floorBz = 0
    forEachCollidingBlock(options, box, (block) => {
      if (block.maxY - box.minY <= reach && block.maxY > floorTop) {
        floorTop = block.maxY
        floorBx = Math.floor(block.minX)
        floorBy = Math.floor(block.minY)
        floorBz = Math.floor(block.minZ)
      }
    })
    if (floorTop > Number.NEGATIVE_INFINITY) {
      const bounciness = clampBounciness(options.bouncinessAt?.(floorBx, floorBy, floorBz))
      if (bounciness > 0) {
        return {
          blocked: true,
          bounced: true,
          position: floorTop + options.halfHeight,
          velocity: -state.velocity * bounciness,
        }
      }
      return { blocked: true, position: floorTop + options.halfHeight, velocity: 0 }
    }
    return state
  }

  const reach = state.velocity * deltaTime + CONTACT_EPSILON
  let ceiling = Number.POSITIVE_INFINITY
  forEachCollidingBlock(options, box, (block) => {
    if (box.maxY - block.minY <= reach) {
      ceiling = Math.min(ceiling, block.minY)
    }
  })
  if (ceiling < Number.POSITIVE_INFINITY) {
    return { blocked: true, position: ceiling - options.halfHeight, velocity: 0 }
  }
  return state
}
