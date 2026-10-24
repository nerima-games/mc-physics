import {
  type AABB,
  type BlockShape,
  aabbOfCollisionShape,
  aabbsOfBlockShape,
  blockAABB,
  collidesWith,
  intersects,
  isRestingOn,
} from './coordinates.js'
import { BlockAxis, BlockContactDamage, PositionAxis } from '@nerima-games/mc-kernel'
import type {
  BlockEnvironment,
  BlockHazards,
  BlockSample,
  FluidEffects,
  FluidFlow,
  FluidStateAt,
  SurfaceEffects,
} from './environment-types.js'
import { BlockLength, BlocksPerSecond } from './physical-units.js'
import { Brand, Result } from 'effect'
import type { Body } from './integrate.js'
import { FULL_BLOCK_SHAPE } from './shape-data.js'

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

const forEachCoordinateRange = (
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  visit: (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => Result.Result<void, Brand.BrandError | RangeError>,
): Result.Result<void, Brand.BrandError | RangeError> => {
  const bounds = Result.all([
    BlockAxis.result(minX),
    BlockAxis.result(maxX),
    BlockAxis.result(minY),
    BlockAxis.result(maxY),
    BlockAxis.result(minZ),
    BlockAxis.result(maxZ),
  ])
  if (Result.isFailure(bounds)) {
    return Result.fail(bounds.failure)
  }
  const [validMinX, validMaxX, validMinY, validMaxY, validMinZ, validMaxZ] = bounds.success

  for (let bx = Number(validMinX); bx <= validMaxX; bx += 1) {
    for (let by = Number(validMinY); by <= validMaxY; by += 1) {
      for (let bz = Number(validMinZ); bz <= validMaxZ; bz += 1) {
        const visited = visit(BlockAxis(bx), BlockAxis(by), BlockAxis(bz))
        if (Result.isFailure(visited)) {
          return visited
        }
      }
    }
  }
  return Result.succeed(globalThis.undefined)
}

const forEachCell = (
  box: AABB,
  visit: (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => Result.Result<void, Brand.BrandError | RangeError>,
): Result.Result<void, Brand.BrandError | RangeError> => {
  const bounds = cellBounds(box)
  return forEachCoordinateRange(
    bounds.minX,
    bounds.maxX,
    bounds.minY,
    bounds.maxY,
    bounds.minZ,
    bounds.maxZ,
    visit,
  )
}

const localShapeAt = (
  environment: BlockEnvironment,
  bx: BlockAxis,
  by: BlockAxis,
  bz: BlockAxis,
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

const clampedUnit = (value: number): number => Math.min(1, Math.max(0, finiteOr(value, 0)))

const touchesCell = (box: AABB, cell: AABB): boolean =>
  box.minX <= cell.maxX &&
  box.maxX >= cell.minX &&
  box.minY <= cell.maxY &&
  box.maxY >= cell.minY &&
  box.minZ <= cell.maxZ &&
  box.maxZ >= cell.minZ

export const sampleSurfaceEffects = (
  box: AABB,
  environment: BlockEnvironment,
): Result.Result<SurfaceEffects, Brand.BrandError | RangeError> => {
  const feetCell = Math.floor(box.minY)
  const minX = Math.floor(box.minX)
  const maxX = Math.floor(box.maxX)
  const minZ = Math.floor(box.minZ)
  const maxZ = Math.floor(box.maxZ)
  let { friction, movementDrag } = DEFAULT_SURFACE_EFFECTS

  const supportScan = forEachCoordinateRange(minX, maxX, feetCell - 1, feetCell, minZ, maxZ, (bx, by, bz) => {
    const sample = environment.blockAt(bx, by, bz)
    if (sample === null) {
      return Result.succeed(globalThis.undefined)
    }

    for (const shape of localShapeAt(environment, bx, by, bz, sample)) {
      const worldShape = blockAABB(bx, by, bz, shape)
      if (Result.isFailure(worldShape)) {
        return Result.fail(worldShape.failure)
      }
      if (isRestingOn(box, worldShape.success)) {
        friction = Math.min(friction, clampedUnit(sample.properties.friction))
        break
      }
    }
    return Result.succeed(globalThis.undefined)
  })
  if (Result.isFailure(supportScan)) {
    return Result.fail(supportScan.failure)
  }

  const dragScan = forEachCell(box, (bx, by, bz) => {
    const sample = environment.blockAt(bx, by, bz)
    if (sample === null) {
      return Result.succeed(globalThis.undefined)
    }
    return Result.map(blockAABB(bx, by, bz), (cell) => {
      if (intersects(box, cell)) {
        movementDrag = Math.max(movementDrag, clampedUnit(sample.properties.movementDrag))
      }
    })
  })
  if (Result.isFailure(dragScan)) {
    return Result.fail(dragScan.failure)
  }

  return Result.succeed({ friction, movementDrag })
}

export const applySurfaceMotion = (
  body: Body,
  effects: SurfaceEffects,
): Result.Result<Body, Brand.BrandError> => {
  if (body.kind !== 'dynamic') {
    return Result.succeed(body)
  }

  const vxSnapshot = body.vx
  const vySnapshot = body.vy
  const vzSnapshot = body.vz
  const inputs = Result.all([
    BlocksPerSecond.result(vxSnapshot),
    BlocksPerSecond.result(vySnapshot),
    BlocksPerSecond.result(vzSnapshot),
  ])
  return Result.flatMap(inputs, ([vx, vy, vz]) => {
    const multiplier = clampedUnit(effects.friction) * (1 - clampedUnit(effects.movementDrag))
    const verticalMultiplier = 1 - clampedUnit(effects.movementDragY ?? 0)
    return Result.map(
      Result.all([
        BlocksPerSecond.result(vx * multiplier),
        BlocksPerSecond.result(vy * verticalMultiplier),
        BlocksPerSecond.result(vz * multiplier),
      ]),
      ([nextVx, nextVy, nextVz]): Body => ({ ...body, vx: nextVx, vy: nextVy, vz: nextVz }),
    )
  })
}

export const sampleBlockHazards = (
  box: AABB,
  environment: BlockEnvironment,
): Result.Result<BlockHazards, Brand.BrandError | RangeError> => {
  let contactDamage = BlockContactDamage(0)
  let suffocating = false
  let climbable = false

  const scan = forEachCell(box, (bx, by, bz) => {
    const sample = environment.blockAt(bx, by, bz)
    if (sample === null) {
      return Result.succeed(globalThis.undefined)
    }

    return Result.flatMap(blockAABB(bx, by, bz), (cell) => {
      const touches = touchesCell(box, cell)
      const damageSnapshot = sample.properties.contactDamage
      const damage = BlockContactDamage.result(damageSnapshot)
      if (Result.isFailure(damage)) {
        return Result.fail(damage.failure)
      }
      if (touches && sample.capabilities.climbable) {
        climbable = true
      }
      if (touches && damage.success > contactDamage) {
        contactDamage = damage.success
      }

      for (const shape of localShapeAt(environment, bx, by, bz, sample)) {
        const collisionBox = blockAABB(bx, by, bz, shape)
        if (Result.isFailure(collisionBox)) {
          return Result.fail(collisionBox.failure)
        }
        if (collidesWith(box, collisionBox.success) && sample.capabilities.suffocates) {
          suffocating = true
        }
      }
      return Result.succeed(globalThis.undefined)
    })
  })
  if (Result.isFailure(scan)) {
    return Result.fail(scan.failure)
  }

  return Result.succeed({ climbable, contactDamage, suffocating })
}

const overlapLength = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
  Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin))

const validFlow = (flow: FluidFlow): FluidFlow => ({
  x: finiteOr(flow.x, 0),
  y: finiteOr(flow.y, 0),
  z: finiteOr(flow.z, 0),
})

export const sampleFluidEffects = (
  box: AABB,
  environment: BlockEnvironment,
  fluidStateAt: FluidStateAt,
): Result.Result<FluidEffects, Brand.BrandError | RangeError> => {
  const widthResults = Result.all([
    BlockLength.result(box.maxX - box.minX),
    BlockLength.result(box.maxY - box.minY),
    BlockLength.result(box.maxZ - box.minZ),
  ])
  return Result.flatMap(widthResults, ([widthX, widthY, widthZ]) => {
    if (widthX <= 0 || widthY <= 0 || widthZ <= 0) {
      return Result.succeed({ flow: { x: 0, y: 0, z: 0 }, lavaVolume: 0, waterVolume: 0 })
    }

    let waterVolume = 0
    let lavaVolume = 0
    let totalVolume = 0
    let flowX = 0
    let flowY = 0
    let flowZ = 0

    const scan = forEachCell(box, (bx, by, bz) => {
      const sample = environment.blockAt(bx, by, bz)
      if (sample === null) {
        return Result.succeed(globalThis.undefined)
      }
      const kind = sample.properties.fluid
      if (kind === 'none') {
        return Result.succeed(globalThis.undefined)
      }

      const state = fluidStateAt(bx, by, bz, kind)
      if (state === null) {
        return Result.succeed(globalThis.undefined)
      }
      const levelSnapshot = state.level
      const level = clampedUnit(levelSnapshot)
      if (level === 0) {
        return Result.succeed(globalThis.undefined)
      }

      return Result.flatMap(PositionAxis.result(level), (maxY) =>
        Result.flatMap(
          blockAABB(bx, by, bz, { ...FULL_BLOCK_SHAPE, maxY }),
          (fluidBox) => {
            const volumeX = overlapLength(box.minX, box.maxX, fluidBox.minX, fluidBox.maxX) / widthX
            const volumeY = overlapLength(box.minY, box.maxY, fluidBox.minY, fluidBox.maxY) / widthY
            const volumeZ = overlapLength(box.minZ, box.maxZ, fluidBox.minZ, fluidBox.maxZ) / widthZ
            const contribution = volumeX * volumeY * volumeZ
            if (contribution === 0) {
              return Result.succeed(globalThis.undefined)
            }

            if (kind === 'water') {
              waterVolume += contribution
            } else {
              lavaVolume += contribution
            }
            totalVolume += contribution
            const flowSnapshot = state.flow
            const flow = validFlow(flowSnapshot)
            flowX += flow.x * contribution
            flowY += flow.y * contribution
            flowZ += flow.z * contribution
            return Result.succeed(globalThis.undefined)
          },
        ),
      )
    })
    if (Result.isFailure(scan)) {
      return Result.fail(scan.failure)
    }

    let flow: FluidFlow = { x: 0, y: 0, z: 0 }
    if (totalVolume !== 0) {
      flow = {
        x: finiteOr(flowX / totalVolume, 0),
        y: finiteOr(flowY / totalVolume, 0),
        z: finiteOr(flowZ / totalVolume, 0),
      }
    }
    return Result.succeed({ flow, lavaVolume: clampedUnit(lavaVolume), waterVolume: clampedUnit(waterVolume) })
  })
}
