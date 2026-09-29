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
import { CentreY } from './coordinates.js'
import type { Position } from '@nerima-games/mc-kernel'

const translated = (entity: EntityCollider, dx: number, dy: number, dz: number): EntityCollider => {
  if (entity.body.kind !== 'dynamic') {
    return entity
  }
  return {
    ...entity,
    body: {
      ...entity.body,
      x: entity.body.x + dx,
      y: CentreY(entity.body.y + dy),
      z: entity.body.z + dz,
    },
  }
}

const velocityChanged = (entity: EntityCollider, impulse: Position, scale: number): EntityCollider => {
  if (entity.body.kind !== 'dynamic' || scale === 0) {
    return entity
  }
  return {
    ...entity,
    body: {
      ...entity.body,
      vx: entity.body.vx + impulse.x * scale,
      vy: entity.body.vy + impulse.y * scale,
      vz: entity.body.vz + impulse.z * scale,
    },
  }
}

const resolvePair = (
  first: EntityCollider,
  second: EntityCollider,
  collision: EntityCollision,
  restitution: number,
): Readonly<{ readonly first: EntityCollider; readonly second: EntityCollider; readonly changed: boolean }> => {
  const firstInverseMass = inverseMassOf(first)
  const secondInverseMass = inverseMassOf(second)
  const inverseMassSum = firstInverseMass + secondInverseMass
  if (inverseMassSum === 0) {
    return { changed: false, first, second }
  }

  const firstCorrection = collision.penetration * firstInverseMass / inverseMassSum
  const secondCorrection = collision.penetration * secondInverseMass / inverseMassSum
  let resolvedFirst = translated(
    first,
    -collision.normal.x * firstCorrection,
    -collision.normal.y * firstCorrection,
    -collision.normal.z * firstCorrection,
  )
  let resolvedSecond = translated(
    second,
    collision.normal.x * secondCorrection,
    collision.normal.y * secondCorrection,
    collision.normal.z * secondCorrection,
  )
  const relativeVelocity = {
    x: second.body.vx - first.body.vx,
    y: second.body.vy - first.body.vy,
    z: second.body.vz - first.body.vz,
  }
  const approachingSpeed = relativeVelocity.x * collision.normal.x +
    relativeVelocity.y * collision.normal.y + relativeVelocity.z * collision.normal.z
  if (approachingSpeed < 0) {
    const impulseMagnitude = -(1 + restitution) * approachingSpeed / inverseMassSum
    const impulse = {
      x: collision.normal.x * impulseMagnitude,
      y: collision.normal.y * impulseMagnitude,
      z: collision.normal.z * impulseMagnitude,
    }
    resolvedFirst = velocityChanged(resolvedFirst, impulse, -firstInverseMass)
    resolvedSecond = velocityChanged(resolvedSecond, impulse, secondInverseMass)
  }
  return { changed: true, first: resolvedFirst, second: resolvedSecond }
}

export const resolveEntityCollisions = (
  entities: ReadonlyArray<EntityCollider>,
  options: EntityCollisionOptions = DEFAULT_ENTITY_COLLISION_OPTIONS,
): EntityCollisionResolution => {
  const normalized = normalizedOptions(options)
  /**
   * One copy, taken once. Every index below is derived from `current` itself, so
   * the reads stay in range for the whole call, and a caller-supplied accessor is
   * dereferenced exactly here and never again.
   * `test/entity-collision.test.ts` pins both halves of that contract.
   */
  const current = [...entities]
  const collisions = new Map<string, EntityCollision>()

  for (let iteration = 0; iteration < normalized.iterations; iteration += 1) {
    let changed = false
    for (const [firstIndex, secondIndex] of potentialPairs(current, normalized.cellSize)) {
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
        if (collision) {
          collisions.set(`${collision.firstId}:${collision.secondId}`, collision)
          const resolved = resolvePair(first, second, collision, normalized.restitution)
          if (resolved.changed) {
            current[firstIndex] = resolved.first
            current[secondIndex] = resolved.second
            changed = true
          }
        }
      }
    }
    if (!changed) {
      break
    }
  }

  return { collisions: [...collisions.values()], entities: current }
}
