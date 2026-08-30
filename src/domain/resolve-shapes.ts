import {
  type AABB,
  type CentreY,
  aabbOfCollisionShape,
  aabbsOfBlockShape,
  blockAABB,
  collidesWith,
  entityAABB,
} from './coordinates.js'
import type { ResolveOptions } from './resolve-types.js'

export const blockShapesAt = (options: ResolveOptions, bx: number, by: number, bz: number): ReadonlyArray<AABB> => {
  const customShapeAt = options.blockShapeAt
  if (customShapeAt) {
    const shape = customShapeAt(bx, by, bz)
    if (shape === null) {
      return []
    }
    return aabbsOfBlockShape(shape)
  }

  const properties = options.blockPropertiesAt(bx, by, bz)
  if (properties === null) {
    return []
  }
  const shape = aabbOfCollisionShape(properties.collisionShape)
  if (shape === null) {
    return []
  }
  return [shape]
}

export const boxAt = (options: ResolveOptions, x: number, y: CentreY, z: number): AABB =>
  entityAABB(x, y, z, options.halfWidth, options.halfHeight)

export const forEachCollidingBlock = (
  options: ResolveOptions,
  box: AABB,
  visit: (block: AABB) => void,
): void => {
  const bxMax = Math.floor(box.maxX)
  const byMax = Math.floor(box.maxY)
  const bzMax = Math.floor(box.maxZ)

  for (let bx = Math.floor(box.minX); bx <= bxMax; bx += 1) {
    for (let by = Math.floor(box.minY); by <= byMax; by += 1) {
      for (let bz = Math.floor(box.minZ); bz <= bzMax; bz += 1) {
        for (const shape of blockShapesAt(options, bx, by, bz)) {
          const blockBox = blockAABB(bx, by, bz, shape)
          if (collidesWith(box, blockBox)) {
            visit(blockBox)
          }
        }
      }
    }
  }
}
