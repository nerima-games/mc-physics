import { CentreY, type HalfHeight, collidesWith, entityAABB } from './coordinates'
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

const inverseMassOf = (entity: EntityCollider): number => {
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

const collisionOf = (first: EntityCollider, second: EntityCollider): EntityCollision | null => {
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

const normalizedOptions = (options: EntityCollisionOptions): EntityCollisionOptions => {
  const { cellSize: requestedCellSize, iterations, restitution } = options
  const { cellSize: defaultCellSize, iterations: defaultIterations } = DEFAULT_ENTITY_COLLISION_OPTIONS
  const normalizedCellSize = finiteOr(requestedCellSize, defaultCellSize)
  let cellSize = defaultCellSize
  if (normalizedCellSize > 0) {
    cellSize = normalizedCellSize
  }
  return {
    cellSize,
    iterations: Math.max(1, Math.floor(finiteOr(iterations, defaultIterations))),
    restitution: Math.min(1, nonNegative(restitution)),
  }
}

const cellKey = (x: number, y: number, z: number): string => `${x}:${y}:${z}`

const potentialPairs = (
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
  const current = [...entities]
  const collisions = new Map<string, EntityCollision>()

  for (let iteration = 0; iteration < normalized.iterations; iteration += 1) {
    let changed = false
    for (const [firstIndex, secondIndex] of potentialPairs(current, normalized.cellSize)) {
      const first = current[firstIndex]!
      const second = current[secondIndex]!
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
    if (!changed) {
      break
    }
  }

  return { collisions: [...collisions.values()], entities: current }
}
