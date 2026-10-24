import { BlockLength, BlocksPerSecond, InverseMass, velocityVectorResult } from './physical-units.js'
import { Brand, Result } from 'effect'
import {
  DEFAULT_ENTITY_COLLISION_OPTIONS,
  type EntityCollider,
  type EntityCollision,
  type EntityCollisionOptions,
  type EntityCollisionResolution,
  collisionOf,
  inverseMassOf,
  normalizedOptions,
  potentialPairs,
} from './entity-collision.js'
import { EntityId, type Position, PositionAxis } from '@nerima-games/mc-kernel'
import { CentreY } from './coordinates.js'

const translated = (
  entity: EntityCollider,
  dx: BlockLength,
  dy: BlockLength,
  dz: BlockLength,
): Result.Result<EntityCollider, Brand.BrandError> => {
  if (entity.body.kind !== 'dynamic') {
    return Result.succeed(entity)
  }
  const position = Result.all([
    PositionAxis.result(entity.body.x + dx),
    CentreY.result(entity.body.y + dy),
    PositionAxis.result(entity.body.z + dz),
  ])
  if (Result.isFailure(position)) {
    return Result.fail(position.failure)
  }
  const [x, y, z] = position.success
  return Result.succeed({ ...entity, body: { ...entity.body, x, y, z } })
}

const velocityChanged = (
  entity: EntityCollider,
  normal: Position,
  impulseMagnitude: number,
  inverseMass: InverseMass,
  sign: -1 | 1,
): Result.Result<EntityCollider, Brand.BrandError> => {
  if (entity.body.kind !== 'dynamic' || inverseMass === 0) {
    return Result.succeed(entity)
  }
  const scale = sign * inverseMass
  const velocity = velocityVectorResult(
    entity.body.vx + normal.x * impulseMagnitude * scale,
    entity.body.vy + normal.y * impulseMagnitude * scale,
    entity.body.vz + normal.z * impulseMagnitude * scale,
  )
  if (Result.isFailure(velocity)) {
    return Result.fail(velocity.failure)
  }
  return Result.succeed({
    ...entity,
    body: {
      ...entity.body,
      vx: velocity.success.x,
      vy: velocity.success.y,
      vz: velocity.success.z,
    },
  })
}

const resolvePair = (
  first: EntityCollider,
  second: EntityCollider,
  collision: EntityCollision,
  restitution: number,
): Result.Result<Readonly<{ readonly first: EntityCollider; readonly second: EntityCollider; readonly changed: boolean }>, Brand.BrandError> => {
  const inverseMasses = Result.all([inverseMassOf(first), inverseMassOf(second)])
  if (Result.isFailure(inverseMasses)) {
    return Result.fail(inverseMasses.failure)
  }
  const [firstInverseMass, secondInverseMass] = inverseMasses.success
  const inverseMassSum = InverseMass.result(firstInverseMass + secondInverseMass)
  if (Result.isFailure(inverseMassSum)) {
    return Result.fail(inverseMassSum.failure)
  }
  if (inverseMassSum.success === 0) {
    return Result.succeed({ changed: false, first, second })
  }

  const firstCorrection = BlockLength.result(collision.penetration * firstInverseMass / inverseMassSum.success)
  if (Result.isFailure(firstCorrection)) {
    return Result.fail(firstCorrection.failure)
  }
  const secondCorrection = BlockLength.result(collision.penetration * secondInverseMass / inverseMassSum.success)
  if (Result.isFailure(secondCorrection)) {
    return Result.fail(secondCorrection.failure)
  }
  const firstDelta = Result.all([
    BlockLength.result(-collision.normal.x * firstCorrection.success),
    BlockLength.result(-collision.normal.y * firstCorrection.success),
    BlockLength.result(-collision.normal.z * firstCorrection.success),
  ])
  const secondDelta = Result.all([
    BlockLength.result(collision.normal.x * secondCorrection.success),
    BlockLength.result(collision.normal.y * secondCorrection.success),
    BlockLength.result(collision.normal.z * secondCorrection.success),
  ])
  return Result.flatMap(firstDelta, (firstDeltaValues) =>
    Result.flatMap(secondDelta, (secondDeltaValues) => {
      const resolvedFirstPosition = translated(first, ...firstDeltaValues)
      if (Result.isFailure(resolvedFirstPosition)) {
        return Result.fail(resolvedFirstPosition.failure)
      }
      const resolvedSecondPosition = translated(second, ...secondDeltaValues)
      if (Result.isFailure(resolvedSecondPosition)) {
        return Result.fail(resolvedSecondPosition.failure)
      }
      const relativeVelocity = {
        x: second.body.vx - first.body.vx,
        y: second.body.vy - first.body.vy,
        z: second.body.vz - first.body.vz,
      }
      const checkedRelativeVelocity = velocityVectorResult(relativeVelocity.x, relativeVelocity.y, relativeVelocity.z)
      if (Result.isFailure(checkedRelativeVelocity)) {
        return Result.fail(checkedRelativeVelocity.failure)
      }
      const approachingSpeed = BlocksPerSecond.result(
        checkedRelativeVelocity.success.x * collision.normal.x +
        checkedRelativeVelocity.success.y * collision.normal.y +
        checkedRelativeVelocity.success.z * collision.normal.z,
      )
      return Result.flatMap(approachingSpeed, (checkedApproachingSpeed) => {
        if (checkedApproachingSpeed < 0) {
          const impulseMagnitude = -(1 + restitution) * checkedApproachingSpeed / inverseMassSum.success
          const firstVelocity = velocityChanged(
            resolvedFirstPosition.success,
            collision.normal,
            impulseMagnitude,
            firstInverseMass,
            -1,
          )
          return Result.flatMap(firstVelocity, (resolvedFirst) =>
            Result.map(velocityChanged(resolvedSecondPosition.success, collision.normal, impulseMagnitude, secondInverseMass, 1),
              (resolvedSecond) => ({ changed: true, first: resolvedFirst, second: resolvedSecond }),
            ),
          )
        }
        return Result.succeed({
          changed: true,
          first: resolvedFirstPosition.success,
          second: resolvedSecondPosition.success,
        })
      })
    }),
  )
}

export const resolveEntityCollisions = (
  entities: ReadonlyArray<EntityCollider>,
  options: EntityCollisionOptions = DEFAULT_ENTITY_COLLISION_OPTIONS,
): Result.Result<EntityCollisionResolution, Brand.BrandError | RangeError> => {
  const normalized = normalizedOptions(options)
  /**
   * One copy, taken once. Every index below is derived from `current` itself, so
   * the reads stay in range for the whole call, and a caller-supplied accessor is
   * dereferenced exactly here and never again.
   * `test/entity-collision.test.ts` pins both halves of that contract.
   */
  const current = [...entities]
  for (const entity of current) {
    if (entity !== globalThis.undefined) {
      const id = EntityId.result(entity.id)
      if (Result.isFailure(id)) {
        return Result.fail(id.failure)
      }
      const inverseMass = inverseMassOf(entity)
      if (Result.isFailure(inverseMass)) {
        return Result.fail(inverseMass.failure)
      }
      const velocity = velocityVectorResult(entity.body.vx, entity.body.vy, entity.body.vz)
      if (Result.isFailure(velocity)) {
        return Result.fail(velocity.failure)
      }
    }
  }
  const collisions = new Map<string, EntityCollision>()

  for (let iteration = 0; iteration < normalized.iterations; iteration += 1) {
    let changed = false
    const pairs = potentialPairs(current, normalized.cellSize)
    if (Result.isFailure(pairs)) {
      return Result.fail(pairs.failure)
    }
    for (const [firstIndex, secondIndex] of pairs.success) {
      const first = current[firstIndex]
      const second = current[secondIndex]
      /**
       * `current` is this function's own dense copy and its length is fixed for
       * the whole call, so the index `potentialPairs` derived is always in range
       * and the guard is never false. `noUncheckedIndexedAccess` cannot see that,
       * which is the case `vitest.config.ts`'s thresholds comment reserves an
       * exemption for. The live read matters: the writes below are what later
       * pairs of the same iteration must resolve against.
       */
      /* v8 ignore start */
      if (first && second) {
        /* v8 ignore stop */
        const collision = collisionOf(first, second)
        if (Result.isFailure(collision)) {
          return Result.fail(collision.failure)
        }
        if (collision.success) {
          collisions.set(`${collision.success.firstId}:${collision.success.secondId}`, collision.success)
          const resolved = resolvePair(first, second, collision.success, normalized.restitution)
          if (Result.isFailure(resolved)) {
            return Result.fail(resolved.failure)
          }
          if (resolved.success.changed) {
            current[firstIndex] = resolved.success.first
            current[secondIndex] = resolved.success.second
            changed = true
          }
        }
      }
    }
    if (!changed) {
      break
    }
  }

  return Result.succeed({ collisions: [...collisions.values()], entities: current })
}
