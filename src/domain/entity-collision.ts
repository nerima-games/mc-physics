import { type HalfHeight, collidesWith, entityAABB } from './coordinates'
import type { Body } from './integrate'
import type { Position } from '@nerima-games/mc-kernel'

export type EntityCollider = Readonly<{
  readonly id: string
  readonly body: Body
  readonly halfWidth: number
  readonly halfHeight: HalfHeight
  readonly mass: number
  readonly collidable?: boolean
}>

export type EntityCollision = Readonly<{
  readonly firstId: string
  readonly secondId: string
  readonly normal: Position
  readonly penetration: number
}>

export type EntityCollisionOptions = Readonly<{
  readonly cellSize: number
  readonly iterations: number
  readonly restitution: number
}>

export type EntityCollisionResolution = Readonly<{
  readonly entities: ReadonlyArray<EntityCollider>
  readonly collisions: ReadonlyArray<EntityCollision>
}>

export const DEFAULT_ENTITY_COLLISION_OPTIONS: EntityCollisionOptions = {
  cellSize: 2,
  iterations: 2,
  restitution: 0,
}

/**
 * A cell smaller than 1/4 block stops being a meaningful spatial-hash bucket
 * and becomes purely a cost: `potentialPairs` registers an entity into every
 * cell its AABB spans, so an arbitrarily small cellSize (PoC: 1e-6, ~6.5e17
 * cell registrations for one entity) is a resource-exhaustion vector, not a
 * finer broad phase.
 */
export const MIN_CELL_SIZE = 0.25

/**
 * `resolveEntityCollisions` loops up to `iterations` times over every
 * potential pair per call; an unbounded iterations count (attacker-supplied
 * or malformed config) turns one call into an unbounded amount of work.
 */
export const MAX_ITERATIONS = 64

const finiteOr = (value: number, fallback: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return fallback
}

const nonNegative = (value: number): number => Math.max(0, finiteOr(value, 0))

const isCollidable = (entity: EntityCollider): boolean => entity.collidable !== false

const boxOf = (entity: EntityCollider) =>
  entityAABB(entity.body.x, entity.body.y, entity.body.z, nonNegative(entity.halfWidth), entity.halfHeight)

export const inverseMassOf = (entity: EntityCollider): number => {
  if (entity.body.kind === 'dynamic' && Number.isFinite(entity.mass) && entity.mass > 0) {
    return 1 / entity.mass
  }
  return 0
}

const normalForAxis = (axis: 'x' | 'y' | 'z', delta: number): Position => {
  let sign = -1
  if (delta >= 0) {
    sign = 1
  }
  if (axis === 'x') {
    return { x: sign, y: 0, z: 0 }
  }
  if (axis === 'y') {
    return { x: 0, y: sign, z: 0 }
  }
  return { x: 0, y: 0, z: sign }
}

export const collisionOf = (first: EntityCollider, second: EntityCollider): EntityCollision | null => {
  const firstBox = boxOf(first)
  const secondBox = boxOf(second)
  if (!collidesWith(firstBox, secondBox)) {
    return null
  }

  const penetrationX = Math.min(firstBox.maxX, secondBox.maxX) - Math.max(firstBox.minX, secondBox.minX)
  const penetrationY = Math.min(firstBox.maxY, secondBox.maxY) - Math.max(firstBox.minY, secondBox.minY)
  const penetrationZ = Math.min(firstBox.maxZ, secondBox.maxZ) - Math.max(firstBox.minZ, secondBox.minZ)
  let axis: 'x' | 'y' | 'z' = 'x'
  let penetration = penetrationX
  if (penetrationY < penetration) {
    axis = 'y'
    penetration = penetrationY
  }
  if (penetrationZ < penetration) {
    axis = 'z'
    penetration = penetrationZ
  }
  let delta = second.body.z - first.body.z
  if (axis === 'x') {
    delta = second.body.x - first.body.x
  } else if (axis === 'y') {
    delta = second.body.y - first.body.y
  }
  return {
    firstId: first.id,
    normal: normalForAxis(axis, delta),
    penetration,
    secondId: second.id,
  }
}

export const normalizedOptions = (options: EntityCollisionOptions): EntityCollisionOptions => {
  const { cellSize: requestedCellSize, iterations, restitution } = options
  const { cellSize: defaultCellSize, iterations: defaultIterations } = DEFAULT_ENTITY_COLLISION_OPTIONS
  const normalizedCellSize = finiteOr(requestedCellSize, defaultCellSize)
  let cellSize = defaultCellSize
  if (normalizedCellSize > 0) {
    cellSize = normalizedCellSize
  }
  return {
    cellSize: Math.max(MIN_CELL_SIZE, cellSize),
    iterations: Math.min(MAX_ITERATIONS, Math.max(1, Math.floor(finiteOr(iterations, defaultIterations)))),
    restitution: Math.min(1, nonNegative(restitution)),
  }
}

const cellKey = (x: number, y: number, z: number): string => `${x}:${y}:${z}`

export const potentialPairs = (
  entities: ReadonlyArray<EntityCollider>,
  cellSize: number,
): ReadonlyArray<readonly [number, number]> => {
  const cells = new Map<string, Array<number>>()
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index]
    if (entity && isCollidable(entity)) {
      const box = boxOf(entity)
      const minX = Math.floor(box.minX / cellSize)
      const maxX = Math.floor(box.maxX / cellSize)
      const minY = Math.floor(box.minY / cellSize)
      const maxY = Math.floor(box.maxY / cellSize)
      const minZ = Math.floor(box.minZ / cellSize)
      const maxZ = Math.floor(box.maxZ / cellSize)
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            const key = cellKey(x, y, z)
            const bucket = cells.get(key)
            if (bucket) {
              bucket.push(index)
            } else {
              cells.set(key, [index])
            }
          }
        }
      }
    }
  }

  const pairs = new Map<number, readonly [number, number]>()
  for (const bucket of cells.values()) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const first = Math.min(bucket[left]!, bucket[right]!)
        const second = Math.max(bucket[left]!, bucket[right]!)
        pairs.set(first * entities.length + second, [first, second])
      }
    }
  }
  const orderedPairs = [...pairs.values()]
  orderedPairs.sort(
    ([firstLeft, secondLeft], [firstRight, secondRight]) =>
      firstLeft - firstRight || secondLeft - secondRight,
  )
  return orderedPairs
}

export const detectEntityCollisions = (
  entities: ReadonlyArray<EntityCollider>,
  options: EntityCollisionOptions = DEFAULT_ENTITY_COLLISION_OPTIONS,
): ReadonlyArray<EntityCollision> => {
  const { cellSize } = normalizedOptions(options)
  const collisions: Array<EntityCollision> = []
  for (const [firstIndex, secondIndex] of potentialPairs(entities, cellSize)) {
    const first = entities[firstIndex]!
    const second = entities[secondIndex]!
    const collision = collisionOf(first, second)
    if (collision) {
      collisions.push(collision)
    }
  }
  return collisions
}
