import { type AABB, type HalfHeight, collidesWith, entityAABB } from './coordinates.js'
import { BlockAxis, EntityId, type EntityId as EntityIdValue, type Position, PositionAxis, position } from '@nerima-games/mc-kernel'
import { BlockLength, InverseMass, Mass, type Mass as MassValue } from './physical-units.js'
import { Brand, Result } from 'effect'
import type { Body } from './integrate.js'

export type EntityCollider = Readonly<{
  readonly id: EntityIdValue
  readonly body: Body
  readonly halfWidth: BlockLength
  readonly halfHeight: HalfHeight
  readonly mass: MassValue | 0
  readonly collidable?: boolean
}>

export type EntityCollision = Readonly<{
  readonly firstId: EntityIdValue
  readonly secondId: EntityIdValue
  readonly normal: Position
  readonly penetration: BlockLength
}>

export type EntityCollisionOptions = Readonly<{
  readonly cellSize: BlockLength
  readonly iterations: number
  readonly restitution: number
}>

export type EntityCollisionResolution = Readonly<{
  readonly entities: ReadonlyArray<EntityCollider>
  readonly collisions: ReadonlyArray<EntityCollision>
}>

const DEFAULT_CELL_SIZE = 2

export const DEFAULT_ENTITY_COLLISION_OPTIONS: EntityCollisionOptions = {
  cellSize: BlockLength(DEFAULT_CELL_SIZE),
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
const MIN_CELL_SIZE_VALUE = 0.25
export const MIN_CELL_SIZE: BlockLength = BlockLength(MIN_CELL_SIZE_VALUE)

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

const boxOf = (entity: EntityCollider): Result.Result<AABB, Brand.BrandError | RangeError> => {
  const halfWidth = BlockLength.result(nonNegative(entity.halfWidth))
  return Result.flatMap(halfWidth, (checkedHalfWidth) =>
    entityAABB(entity.body.x, entity.body.y, entity.body.z, checkedHalfWidth, entity.halfHeight),
  )
}

export const inverseMassOf = (entity: EntityCollider): Result.Result<InverseMass, Brand.BrandError> => {
  if (entity.mass === 0) {
    return Result.succeed(InverseMass(0))
  }
  const mass = Mass.result(entity.mass)
  if (Result.isFailure(mass)) {
    return Result.fail(mass.failure)
  }
  if (entity.body.kind === 'dynamic') {
    return InverseMass.result(1 / mass.success)
  }
  return Result.succeed(InverseMass(0))
}

const normalForAxis = (axis: 'x' | 'y' | 'z', delta: number): Position => {
  let signValue = -1
  if (delta >= 0) {
    signValue = 1
  }
  const sign = PositionAxis(signValue)
  const zero = PositionAxis(0)
  if (axis === 'x') {
    return position(sign, zero, zero)
  }
  if (axis === 'y') {
    return position(zero, sign, zero)
  }
  return position(zero, zero, sign)
}

export const collisionOf = (
  first: EntityCollider,
  second: EntityCollider,
): Result.Result<EntityCollision | null, Brand.BrandError | RangeError> => {
  const ids = Result.all([EntityId.result(first.id), EntityId.result(second.id)])
  if (Result.isFailure(ids)) {
    return Result.fail(ids.failure)
  }
  const boxes = Result.all([boxOf(first), boxOf(second)])
  if (Result.isFailure(boxes)) {
    return Result.fail(boxes.failure)
  }
  const [firstBox, secondBox] = boxes.success
  if (!collidesWith(firstBox, secondBox)) {
    return Result.succeed(null)
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
  const checkedPenetration = BlockLength.result(penetration)
  if (Result.isFailure(checkedPenetration)) {
    return Result.fail(checkedPenetration.failure)
  }

  let delta = second.body.z - first.body.z
  if (axis === 'x') {
    delta = second.body.x - first.body.x
  } else if (axis === 'y') {
    delta = second.body.y - first.body.y
  }

  return Result.succeed({
    firstId: ids.success[0],
    normal: normalForAxis(axis, delta),
    penetration: checkedPenetration.success,
    secondId: ids.success[1],
  })
}

export const normalizedOptions = (
  options: EntityCollisionOptions,
): EntityCollisionOptions => {
  const { cellSize: requestedCellSize, iterations, restitution } = options
  const { cellSize: defaultCellSize, iterations: defaultIterations } = DEFAULT_ENTITY_COLLISION_OPTIONS
  const normalizedCellSize = finiteOr(requestedCellSize, defaultCellSize)
  let selectedCellSize: number = defaultCellSize
  if (normalizedCellSize > 0) {
    selectedCellSize = normalizedCellSize
  }
  return {
    cellSize: BlockLength(Math.max(MIN_CELL_SIZE, selectedCellSize)),
    iterations: Math.min(MAX_ITERATIONS, Math.max(1, Math.floor(finiteOr(iterations, defaultIterations)))),
    restitution: Math.min(1, nonNegative(restitution)),
  }
}

const cellKey = (x: number, y: number, z: number): string => `${x}:${y}:${z}`

export const potentialPairs = (
  entities: ReadonlyArray<EntityCollider>,
  cellSize: BlockLength,
): Result.Result<ReadonlyArray<readonly [number, number]>, Brand.BrandError | RangeError> => {
  const requestedCellSize = BlockLength.result(cellSize)
  if (Result.isFailure(requestedCellSize)) {
    return Result.fail(requestedCellSize.failure)
  }
  let selectedCellSize: number = DEFAULT_ENTITY_COLLISION_OPTIONS.cellSize
  if (requestedCellSize.success > 0) {
    selectedCellSize = Math.max(MIN_CELL_SIZE, requestedCellSize.success)
  }
  const cells = new Map<string, Array<number>>()
  const pairs = new Map<number, readonly [number, number]>()
  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index]
    if (entity && isCollidable(entity)) {
      const boxResult = boxOf(entity)
      if (Result.isFailure(boxResult)) {
        return Result.fail(boxResult.failure)
      }
      const box = boxResult.success
      const cellBounds = Result.all([
        BlockAxis.result(Math.floor(box.minX / selectedCellSize)),
        BlockAxis.result(Math.floor(box.maxX / selectedCellSize)),
        BlockAxis.result(Math.floor(box.minY / selectedCellSize)),
        BlockAxis.result(Math.floor(box.maxY / selectedCellSize)),
        BlockAxis.result(Math.floor(box.minZ / selectedCellSize)),
        BlockAxis.result(Math.floor(box.maxZ / selectedCellSize)),
      ])
      if (Result.isFailure(cellBounds)) {
        return Result.fail(cellBounds.failure)
      }
      const [minX, maxX, minY, maxY, minZ, maxZ] = cellBounds.success
      for (let x = Number(minX); x <= Number(maxX); x += 1) {
        for (let y = Number(minY); y <= Number(maxY); y += 1) {
          for (let z = Number(minZ); z <= Number(maxZ); z += 1) {
            const key = cellKey(x, y, z)
            const bucket = cells.get(key)
            if (bucket) {
              /**
               * Each entity pairs with everyone already registered in the cell,
               * so every unordered pair is produced once, when its later member
               * arrives, and no bucket index is ever read back.
               */
              for (const existing of bucket) {
                const first = Math.min(existing, index)
                const second = Math.max(existing, index)
                pairs.set(first * entities.length + second, [first, second])
              }
              bucket.push(index)
            } else {
              cells.set(key, [index])
            }
          }
        }
      }
    }
  }

  const orderedPairs = [...pairs.values()]
  orderedPairs.sort(
    ([firstLeft, secondLeft], [firstRight, secondRight]) =>
      firstLeft - firstRight || secondLeft - secondRight,
  )
  return Result.succeed(orderedPairs)
}

export const detectEntityCollisions = (
  entities: ReadonlyArray<EntityCollider>,
  options: EntityCollisionOptions = DEFAULT_ENTITY_COLLISION_OPTIONS,
): Result.Result<ReadonlyArray<EntityCollision>, Brand.BrandError | RangeError> => {
  const normalized = normalizedOptions(options)
  const pairs = potentialPairs(entities, normalized.cellSize)
  if (Result.isFailure(pairs)) {
    return Result.fail(pairs.failure)
  }

  const collisions: Array<EntityCollision> = []
  for (const [firstIndex, secondIndex] of pairs.success) {
    const first = entities[firstIndex]
    const second = entities[secondIndex]
    /**
     * `entities` belongs to the caller, so `noUncheckedIndexedAccess` is right to
     * type both reads as optional: a hole, or an accessor that stops answering
     * between the grid walk that produced the pairs and this loop, leaves the
     * index unreadable. Such a pair is skipped rather than resolved against a
     * missing entity. `test/entity-collision.test.ts` exercises exactly that.
     */
    if (first && second) {
      const collision = collisionOf(first, second)
      if (Result.isFailure(collision)) {
        return Result.fail(collision.failure)
      }
      if (collision.success) {
        collisions.push(collision.success)
      }
    }
  }
  return Result.succeed(collisions)
}
