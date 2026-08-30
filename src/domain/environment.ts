import {
  type AABB,
  type BlockShape,
  aabbOfCollisionShape,
  aabbsOfBlockShape,
  blockAABB,
  collidesWith,
  intersects,
  isRestingOn,
  position,
} from './coordinates.js'
import type {
  BlockEnvironment,
  BlockHazards,
  BlockSample,
  FluidEffects,
  FluidStateAt,
  SurfaceEffects,
} from './environment-types.js'
import type { Body } from './integrate.js'
import { FULL_BLOCK_SHAPE } from './shape-data.js'
import type { Position } from '@nerima-games/mc-kernel'

const DEFAULT_SURFACE_EFFECTS: SurfaceEffects = { friction: 1, movementDrag: 0 }

const cellBounds = (box: AABB): Readonly<{
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}> => ({
  maxX: Math.floor(box.maxX),
  maxY: Math.floor(box.maxY),
  maxZ: Math.floor(box.maxZ),
  minX: Math.floor(box.minX),
  minY: Math.floor(box.minY),
  minZ: Math.floor(box.minZ),
})

const forEachCell = (box: AABB, visit: (bx: number, by: number, bz: number) => void): void => {
  const bounds = cellBounds(box)
  for (let bx = bounds.minX; bx <= bounds.maxX; bx += 1) {
    for (let by = bounds.minY; by <= bounds.maxY; by += 1) {
      for (let bz = bounds.minZ; bz <= bounds.maxZ; bz += 1) {
        visit(bx, by, bz)
      }
    }
  }
}

const localShapeAt = (
  environment: BlockEnvironment,
  bx: number,
  by: number,
  bz: number,
  knownSample: BlockSample,
): ReadonlyArray<AABB> => {
  const customShapeAt = environment.blockShapeAt
  if (customShapeAt) {
    const shape: BlockShape | null = customShapeAt(bx, by, bz)
    if (shape === null) {
      return []
    }
    return aabbsOfBlockShape(shape)
  }

  const shape = aabbOfCollisionShape(knownSample.properties.collisionShape)
  if (shape === null) {
    return []
  }
  return [shape]
}

const finiteOr = (value: number, fallback: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return fallback
}

const nonNegative = (value: number): number => Math.max(0, finiteOr(value, 0))

const clampedUnit = (value: number): number => Math.min(1, Math.max(0, finiteOr(value, 0)))

const touchesCell = (box: AABB, cell: AABB): boolean =>
  box.minX <= cell.maxX &&
  box.maxX >= cell.minX &&
  box.minY <= cell.maxY &&
  box.maxY >= cell.minY &&
  box.minZ <= cell.maxZ &&
  box.maxZ >= cell.minZ

export const sampleSurfaceEffects = (box: AABB, environment: BlockEnvironment): SurfaceEffects => {
  const feetCell = Math.floor(box.minY)
  const minX = Math.floor(box.minX)
  const maxX = Math.floor(box.maxX)
  const minZ = Math.floor(box.minZ)
  const maxZ = Math.floor(box.maxZ)
  const { friction: defaultFriction, movementDrag: defaultMovementDrag } = DEFAULT_SURFACE_EFFECTS
  let friction = defaultFriction
  let movementDrag = defaultMovementDrag

  for (let bx = minX; bx <= maxX; bx += 1) {
    for (let bz = minZ; bz <= maxZ; bz += 1) {
      for (let by = feetCell - 1; by <= feetCell; by += 1) {
        const sample = environment.blockAt(bx, by, bz)
        if (sample !== null) {
          for (const shape of localShapeAt(environment, bx, by, bz, sample)) {
            if (isRestingOn(box, blockAABB(bx, by, bz, shape))) {
              friction = Math.min(friction, clampedUnit(sample.properties.friction))
              break
            }
          }
        }
      }
    }
  }

  forEachCell(box, (bx, by, bz) => {
    const sample = environment.blockAt(bx, by, bz)
    if (sample === null || !intersects(box, blockAABB(bx, by, bz))) {
      return
    }
    movementDrag = Math.max(movementDrag, clampedUnit(sample.properties.movementDrag))
  })

  return { friction, movementDrag }
}

export const applySurfaceMotion = (body: Body, effects: SurfaceEffects): Body => {
  if (body.kind !== 'dynamic') {
    return body
  }

  const multiplier = clampedUnit(effects.friction) * (1 - clampedUnit(effects.movementDrag))
  /*
   * An absent vertical drag multiplies by exactly 1, which IEEE-754 leaves
   * bit-identical for every vy including -0 and NaN.
   */
  const vy = body.vy * (1 - clampedUnit(effects.movementDragY ?? 0))
  return { ...body, vx: body.vx * multiplier, vy, vz: body.vz * multiplier }
}

export const sampleBlockHazards = (box: AABB, environment: BlockEnvironment): BlockHazards => {
  let contactDamage = 0
  let suffocating = false
  let climbable = false

  forEachCell(box, (bx, by, bz) => {
    const sample = environment.blockAt(bx, by, bz)
    if (sample === null) {
      return
    }

    const cell = blockAABB(bx, by, bz)
    const touches = touchesCell(box, cell)
    if (touches && sample.capabilities.climbable) {
      climbable = true
    }

    const damage = nonNegative(sample.properties.contactDamage)
    if (touches && damage > contactDamage) {
      contactDamage = damage
    }
    for (const shape of localShapeAt(environment, bx, by, bz, sample)) {
      const collisionBox = blockAABB(bx, by, bz, shape)
      if (collidesWith(box, collisionBox) && sample.capabilities.suffocates) {
        suffocating = true
      }
    }
  })

  return { climbable, contactDamage, suffocating }
}

const overlapLength = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
  Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin))

const overlapVolume = (a: AABB, b: AABB): number =>
  overlapLength(a.minX, a.maxX, b.minX, b.maxX) *
  overlapLength(a.minY, a.maxY, b.minY, b.maxY) *
  overlapLength(a.minZ, a.maxZ, b.minZ, b.maxZ)

const validFlow = (flow: Position): Position => position(finiteOr(flow.x, 0), finiteOr(flow.y, 0), finiteOr(flow.z, 0))

export const sampleFluidEffects = (
  box: AABB,
  environment: BlockEnvironment,
  fluidStateAt: FluidStateAt,
): FluidEffects => {
  const bodyVolume = Math.max(0, (box.maxX - box.minX) * (box.maxY - box.minY) * (box.maxZ - box.minZ))
  if (bodyVolume === 0) {
    return { flow: position(0, 0, 0), lavaVolume: 0, waterVolume: 0 }
  }

  let waterVolume = 0
  let lavaVolume = 0
  let totalVolume = 0
  let flowX = 0
  let flowY = 0
  let flowZ = 0

  forEachCell(box, (bx, by, bz) => {
    const sample = environment.blockAt(bx, by, bz)
    if (sample === null || sample.properties.fluid === 'none') {
      return
    }

    const state = fluidStateAt(bx, by, bz, sample.properties.fluid)
    if (state === null) {
      return
    }

    const level = clampedUnit(state.level)
    if (level === 0) {
      return
    }

    const fluidBox = blockAABB(bx, by, bz, { ...FULL_BLOCK_SHAPE, maxY: level })
    const volume = overlapVolume(box, fluidBox) / bodyVolume
    if (volume === 0) {
      return
    }

    if (sample.properties.fluid === 'water') {
      waterVolume += volume
    } else {
      lavaVolume += volume
    }
    totalVolume += volume
    const flow = validFlow(state.flow)
    flowX += flow.x * volume
    flowY += flow.y * volume
    flowZ += flow.z * volume
  })

  let flow = position(0, 0, 0)
  if (totalVolume !== 0) {
    flow = position(flowX / totalVolume, flowY / totalVolume, flowZ / totalVolume)
  }
  return { flow, lavaVolume: clampedUnit(lavaVolume), waterVolume: clampedUnit(waterVolume) }
}
