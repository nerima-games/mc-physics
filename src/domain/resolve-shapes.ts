import {
  type AABB,
  type CentreY,
  aabbOfCollisionShape,
  aabbsOfBlockShape,
  blockAABB,
  collidesWith,
  entityAABB,
} from './coordinates.js'
import { BlockAxis, type PositionAxis } from '@nerima-games/mc-kernel'
import type { ResolveError, ResolveOptions } from './resolve-types.js'
import { Result } from 'effect'

const EMPTY_SHAPES: ReadonlyArray<AABB> = []

export const blockShapesAtAxes = (
  options: ResolveOptions,
  blockX: ReturnType<typeof BlockAxis>,
  blockY: ReturnType<typeof BlockAxis>,
  blockZ: ReturnType<typeof BlockAxis>,
): Result.Result<ReadonlyArray<AABB>, ResolveError> => {
  const customShapeAt = options.blockShapeAt
  if (customShapeAt) {
    const shape = customShapeAt(blockX, blockY, blockZ)
    if (shape === null) {
      return Result.succeed(EMPTY_SHAPES)
    }
    return Result.all(aabbsOfBlockShape(shape).map((localShape) => blockAABB(
      blockX,
      blockY,
      blockZ,
      localShape,
    )))
  }

  return Result.flatMap(options.blockPropertiesAt(blockX, blockY, blockZ), (properties) => {
    if (properties === null) {
      return Result.succeed(EMPTY_SHAPES)
    }
    const shape = aabbOfCollisionShape(properties.collisionShape)
    if (shape === null) {
      return Result.succeed(EMPTY_SHAPES)
    }
    return Result.map(blockAABB(blockX, blockY, blockZ, shape), (block) => [block])
  })
}

export const blockShapesAt = (
  options: ResolveOptions,
  bx: number,
  by: number,
  bz: number,
): Result.Result<ReadonlyArray<AABB>, ResolveError> => {
  const blockX = BlockAxis.result(bx)
  const blockY = BlockAxis.result(by)
  const blockZ = BlockAxis.result(bz)
  if (Result.isFailure(blockX)) {
    return Result.fail(blockX.failure)
  }
  if (Result.isFailure(blockY)) {
    return Result.fail(blockY.failure)
  }
  if (Result.isFailure(blockZ)) {
    return Result.fail(blockZ.failure)
  }

  return blockShapesAtAxes(options, blockX.success, blockY.success, blockZ.success)
}

export const boxAt = (
  options: ResolveOptions,
  x: PositionAxis,
  y: CentreY,
  z: PositionAxis,
): Result.Result<AABB, ResolveError> =>
  entityAABB(x, y, z, options.halfWidth, options.halfHeight)

export const forEachCollidingBlock = (
  options: ResolveOptions,
  box: AABB,
  visit: (block: AABB) => void,
): Result.Result<void, ResolveError> => {
  const bounds = Result.all([
    BlockAxis.result(Math.floor(box.minX)),
    BlockAxis.result(Math.floor(box.maxX)),
    BlockAxis.result(Math.floor(box.minY)),
    BlockAxis.result(Math.floor(box.maxY)),
    BlockAxis.result(Math.floor(box.minZ)),
    BlockAxis.result(Math.floor(box.maxZ)),
  ])
  if (Result.isFailure(bounds)) {
    return Result.fail(bounds.failure)
  }
  const [minX, maxX, minY, maxY, minZ, maxZ] = bounds.success

  for (let bx = Number(minX); bx <= maxX; bx += 1) {
    for (let by = Number(minY); by <= maxY; by += 1) {
      for (let bz = Number(minZ); bz <= maxZ; bz += 1) {
        const blocks = blockShapesAtAxes(options, BlockAxis(bx), BlockAxis(by), BlockAxis(bz))
        if (Result.isFailure(blocks)) {
          return Result.fail(blocks.failure)
        }
        for (const block of blocks.success) {
          if (collidesWith(box, block)) {
            visit(block)
          }
        }
      }
    }
  }
  return Result.succeed(globalThis.undefined)
}
