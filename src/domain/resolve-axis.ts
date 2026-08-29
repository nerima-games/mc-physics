import { type AABB, CONTACT_EPSILON } from './coordinates'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import type { ResolveOptions } from './resolve-types'
import { forEachCollidingBlock } from './resolve-shapes'

export type AxisState = {
  readonly blocked: boolean
  readonly position: number
  readonly velocity: number
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
  if (state.velocity <= 0) {
    const reach = -state.velocity * deltaTime + CONTACT_EPSILON
    let floorTop = Number.NEGATIVE_INFINITY
    forEachCollidingBlock(options, box, (block) => {
      if (block.maxY - box.minY <= reach) {
        floorTop = Math.max(floorTop, block.maxY)
      }
    })
    if (floorTop > Number.NEGATIVE_INFINITY) {
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
