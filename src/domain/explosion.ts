import type { Vec3 } from './coordinates'

export type ExplosionBlockPosition = Readonly<{
  readonly x: number
  readonly y: number
  readonly z: number
}>

export type ExplosionBlock = Readonly<{
  readonly resistance: number
  readonly destructible: boolean
}>

export type ExplosionBlockReader = (position: ExplosionBlockPosition) => ExplosionBlock | undefined

export type ExplosionEntity = Readonly<{
  readonly id: string
  readonly feetPosition: Vec3
}>

export type ExplosionEntityEffect = Readonly<{
  readonly id: string
  readonly damage: number
  readonly knockback: Vec3
  readonly exposure: number
}>

export type ExplosionLimits = Readonly<{
  readonly maxVisitedBlocks: number
  readonly maxRaySteps: number
  readonly maxAffectedEntities: number
}>

export const DEFAULT_EXPLOSION_LIMITS: ExplosionLimits = {
  maxAffectedEntities: 1_024,
  maxRaySteps: 128,
  maxVisitedBlocks: 16_384,
}

export type ExplosionRequest = Readonly<{
  readonly center: Vec3
  readonly radius: number
  readonly seed: number
  readonly blocks: ExplosionBlockReader
  readonly entities: ReadonlyArray<ExplosionEntity>
  readonly limits?: Partial<ExplosionLimits>
}>

export type ExplosionPlan = Readonly<{
  readonly center: Vec3
  readonly radius: number
  readonly seed: number
  readonly destroyedBlocks: ReadonlyArray<ExplosionBlockPosition>
  readonly entityEffects: ReadonlyArray<ExplosionEntityEffect>
  readonly visitedBlocks: number
  readonly limits: ExplosionLimits
  readonly truncated: boolean
}>

export type ExplosionMutation = Pick<ExplosionPlan, 'destroyedBlocks' | 'entityEffects'>
export type ExplosionCommit = (mutation: ExplosionMutation) => void

const MAX_DIRECT_TRACE_RADIUS = 8
const BLOCK_CENTER_OFFSET = 0.5
const TRACE_SAMPLES_PER_BLOCK = 4
const BLOCK_RESISTANCE_OFFSET = 0.3
const BLAST_BASE_FACTOR = 0.7
const BLAST_RANDOM_FACTOR = 0.6
const ENTITY_FEET_SAMPLE_HEIGHT = 0.1
const ENTITY_MID_SAMPLE_HEIGHT = 0.9
const ENTITY_HEAD_SAMPLE_HEIGHT = 1.7
const ENTITY_DAMAGE_QUADRATIC_FACTOR = 0.5
const ENTITY_DAMAGE_RADIUS_FACTOR = 7
const ENTITY_DAMAGE_BASE = 1
const HASH_SEED_FACTOR = 19.19
const HASH_X_FACTOR = 12.9898
const HASH_Y_FACTOR = 78.233
const HASH_Z_FACTOR = 37.719
const HASH_SCALE = 43_758.5453

const finite = (value: number, fallback: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return fallback
}

const positiveInteger = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.floor(value))
}

const normaliseLimits = (limits: Partial<ExplosionLimits> | undefined): ExplosionLimits => ({
  maxAffectedEntities: positiveInteger(limits?.maxAffectedEntities, DEFAULT_EXPLOSION_LIMITS.maxAffectedEntities),
  maxRaySteps: positiveInteger(limits?.maxRaySteps, DEFAULT_EXPLOSION_LIMITS.maxRaySteps),
  maxVisitedBlocks: positiveInteger(limits?.maxVisitedBlocks, DEFAULT_EXPLOSION_LIMITS.maxVisitedBlocks),
})

const hashUnit = (seed: number, x: number, y: number, z: number): number => {
  const value = Math.sin(
    finite(seed, 0) * HASH_SEED_FACTOR +
      x * HASH_X_FACTOR +
      y * HASH_Y_FACTOR +
      z * HASH_Z_FACTOR,
  ) * HASH_SCALE
  return value - Math.floor(value)
}

const keyOf = ({ x, y, z }: ExplosionBlockPosition): string => `${x},${y},${z}`

type Trace = Readonly<{
  readonly loaded: boolean
  readonly attenuation: number
  readonly steps: number
}>

type RadialTrace = Readonly<{
  readonly attenuationTo: (target: ExplosionBlockPosition, distance: number) => Trace
  readonly readBlock: ExplosionBlockReader
}>

const trace = (
  center: Vec3,
  destination: Vec3,
  blocks: ExplosionBlockReader,
  maxSteps: number,
  targetKey?: string,
): Trace => {
  const dx = destination.x - center.x
  const dy = destination.y - center.y
  const dz = destination.z - center.z
  const distance = Math.hypot(dx, dy, dz)
  if (distance === 0) {
    return { attenuation: 0, loaded: true, steps: 0 }
  }

  const required = Math.max(1, Math.ceil(distance * TRACE_SAMPLES_PER_BLOCK))
  const samples = Math.min(required, maxSteps)
  if (samples < required) {
    return { attenuation: 0, loaded: false, steps: samples }
  }

  let attenuation = 0
  let previousKey = ''
  for (let step = 1; step <= samples; step += 1) {
    const ratio = step / samples
    const cell = {
      x: Math.floor(center.x + dx * ratio),
      y: Math.floor(center.y + dy * ratio),
      z: Math.floor(center.z + dz * ratio),
    }
    const key = keyOf(cell)
    if (key !== previousKey) {
      previousKey = key
      const block = blocks(cell)
      if (!block) {
        return { attenuation, loaded: false, steps: step }
      }
      if (key !== targetKey) {
        attenuation += Math.max(0, finite(block.resistance, 0)) + BLOCK_RESISTANCE_OFFSET
      }
    }
  }
  return { attenuation, loaded: true, steps: samples }
}

const radialTrace = (
  center: Vec3,
  blocks: ExplosionBlockReader,
  maxSteps: number,
): RadialTrace => {
  const centerCell = {
    x: Math.floor(center.x),
    y: Math.floor(center.y),
    z: Math.floor(center.z),
  }
  const centerKey = keyOf(centerCell)
  const blockCache = new Map<string, ExplosionBlock | undefined>()
  const pathCache = new Map<string, Trace>()

  const readBlock: ExplosionBlockReader = (position) => {
    const key = keyOf(position)
    if (blockCache.has(key)) {return blockCache.get(key)}
    const block = blocks(position)
    blockCache.set(key, block)
    return block
  }

  const pathThrough = (cell: ExplosionBlockPosition): Trace => {
    const key = keyOf(cell)
    const cached = pathCache.get(key)
    if (cached) {
      return cached
    }

    const block = readBlock(cell)
    if (!block) {
      const result = { attenuation: 0, loaded: false, steps: 0 }
      pathCache.set(key, result)
      return result
    }

    if (key === centerKey) {
      const result = {
        attenuation: Math.max(0, finite(block.resistance, 0)) + BLOCK_RESISTANCE_OFFSET,
        loaded: true,
        steps: 1,
      }
      pathCache.set(key, result)
      return result
    }

    const parent = {
      x: cell.x - Math.sign(cell.x - centerCell.x),
      y: cell.y - Math.sign(cell.y - centerCell.y),
      z: cell.z - Math.sign(cell.z - centerCell.z),
    }
    const prefix = pathThrough(parent)
    let result = prefix
    if (prefix.loaded) {
      result = {
        attenuation: prefix.attenuation + Math.max(0, finite(block.resistance, 0)) + BLOCK_RESISTANCE_OFFSET,
        loaded: true,
        steps: prefix.steps + 1,
      }
    }
    pathCache.set(key, result)
    return result
  }

  return {
    attenuationTo: (target, distance) => {
      if (keyOf(target) === centerKey) {
        return { attenuation: 0, loaded: true, steps: 0 }
      }
      const required = Math.max(1, Math.ceil(distance * TRACE_SAMPLES_PER_BLOCK))
      if (required > maxSteps) {
        return { attenuation: 0, loaded: false, steps: maxSteps }
      }
      const parent = {
        x: target.x - Math.sign(target.x - centerCell.x),
        y: target.y - Math.sign(target.y - centerCell.y),
        z: target.z - Math.sign(target.z - centerCell.z),
      }
      const prefix = pathThrough(parent)
      if (!prefix.loaded) {
        return prefix
      }
      return { attenuation: prefix.attenuation, loaded: true, steps: required }
    },
    readBlock,
  }
}

const entityExposure = (
  center: Vec3,
  entity: ExplosionEntity,
  blocks: ExplosionBlockReader,
  maxSteps: number,
): number => {
  const heights = [ENTITY_FEET_SAMPLE_HEIGHT, ENTITY_MID_SAMPLE_HEIGHT, ENTITY_HEAD_SAMPLE_HEIGHT]
  let visible = 0
  for (const height of heights) {
    const result = trace(
      center,
      { ...entity.feetPosition, y: entity.feetPosition.y + height },
      blocks,
      maxSteps,
    )
    if (result.loaded && result.attenuation < 1) {visible += 1}
  }
  return visible / heights.length
}

type BlockDestructionResult = Readonly<{
  readonly destroyedBlocks: ReadonlyArray<ExplosionBlockPosition>
  readonly visitedBlocks: number
  readonly truncated: boolean
}>

const planDestroyedBlocks = (
  center: Vec3,
  radius: number,
  seed: number,
  limits: ExplosionLimits,
  blocks: ExplosionBlockReader,
): BlockDestructionResult => {
  const destroyedBlocks: ExplosionBlockPosition[] = []
  let visitedBlocks = 0
  let truncated = false

  const minimumX = Math.floor(center.x - radius)
  const maximumX = Math.floor(center.x + radius)
  const minimumY = Math.floor(center.y - radius)
  const maximumY = Math.floor(center.y + radius)
  const minimumZ = Math.floor(center.z - radius)
  const maximumZ = Math.floor(center.z + radius)
  let sharedTrace: RadialTrace | undefined
  if (radius > MAX_DIRECT_TRACE_RADIUS) {
    sharedTrace = radialTrace(center, blocks, limits.maxRaySteps)
  }
  let readBlock = blocks
  if (sharedTrace) {
    const { readBlock: sharedReadBlock } = sharedTrace
    readBlock = sharedReadBlock
  }

  for (let y = minimumY; y <= maximumY && !truncated; y += 1) {
    for (let z = minimumZ; z <= maximumZ && !truncated; z += 1) {
      for (let x = minimumX; x <= maximumX && !truncated; x += 1) {
        const target = { x, y, z }
        const distance = Math.hypot(
          x + BLOCK_CENTER_OFFSET - center.x,
          y + BLOCK_CENTER_OFFSET - center.y,
          z + BLOCK_CENTER_OFFSET - center.z,
        )
        if (distance <= radius) {
          if (visitedBlocks >= limits.maxVisitedBlocks) {
            truncated = true
          } else {
            visitedBlocks += 1
            const block = readBlock(target)
            if (block && block.destructible) {
              let ray: Trace
              if (sharedTrace) {
                ray = sharedTrace.attenuationTo(target, distance)
              } else {
                ray = trace(
                  center,
                  {
                    x: x + BLOCK_CENTER_OFFSET,
                    y: y + BLOCK_CENTER_OFFSET,
                    z: z + BLOCK_CENTER_OFFSET,
                  },
                  blocks,
                  limits.maxRaySteps,
                  keyOf(target),
                )
              }
              if (!ray.loaded) {
                if (ray.steps >= limits.maxRaySteps) {
                  truncated = true
                }
              } else {
                const blast = radius * (BLAST_BASE_FACTOR + hashUnit(seed, x, y, z) * BLAST_RANDOM_FACTOR) -
                  distance - ray.attenuation
                if (blast > Math.max(0, finite(block.resistance, 0))) {
                  destroyedBlocks.push(target)
                }
              }
            }
          }
        }
      }
    }
  }

  return { destroyedBlocks, truncated, visitedBlocks }
}

type EntityEffectsResult = Readonly<{
  readonly entityEffects: ReadonlyArray<ExplosionEntityEffect>
  readonly truncated: boolean
}>

const planEntityEffects = (
  center: Vec3,
  radius: number,
  limits: ExplosionLimits,
  blocks: ExplosionBlockReader,
  entities: ReadonlyArray<ExplosionEntity>,
): EntityEffectsResult => {
  const entityEffects: ExplosionEntityEffect[] = []
  let truncated = false
  const entityCount = Math.min(entities.length, limits.maxAffectedEntities)
  if (entityCount < entities.length) {truncated = true}

  for (let index = 0; index < entityCount; index += 1) {
    const entity = entities[index]
    if (entity) {
      const feet = entity.feetPosition
      const target = { x: feet.x, y: feet.y + ENTITY_MID_SAMPLE_HEIGHT, z: feet.z }
      const distance = Math.hypot(target.x - center.x, target.y - center.y, target.z - center.z)
      if (radius > 0 && distance <= radius) {
        const exposure = entityExposure(center, entity, blocks, limits.maxRaySteps)
        if (exposure > 0) {
          const impact = Math.max(0, 1 - distance / radius) * exposure
          const directionLength = Math.hypot(target.x - center.x, target.y - center.y, target.z - center.z)
          let direction = { x: 0, y: 0, z: 0 }
          if (directionLength > 0) {
            direction = {
              x: (target.x - center.x) / directionLength,
              y: (target.y - center.y) / directionLength,
              z: (target.z - center.z) / directionLength,
            }
          }
          entityEffects.push({
            damage: (impact * impact + impact) * ENTITY_DAMAGE_QUADRATIC_FACTOR * ENTITY_DAMAGE_RADIUS_FACTOR * radius +
              ENTITY_DAMAGE_BASE,
            exposure,
            id: entity.id,
            knockback: { x: direction.x * impact, y: direction.y * impact, z: direction.z * impact },
          })
        }
      }
    }
  }

  return { entityEffects, truncated }
}

export const planExplosion = (request: ExplosionRequest): ExplosionPlan => {
  const center = {
    x: finite(request.center.x, 0),
    y: finite(request.center.y, 0),
    z: finite(request.center.z, 0),
  }
  const radius = Math.max(0, finite(request.radius, 0))
  const seed = finite(request.seed, 0)
  const limits = normaliseLimits(request.limits)
  const blocks = planDestroyedBlocks(center, radius, seed, limits, request.blocks)
  const entities = planEntityEffects(center, radius, limits, request.blocks, request.entities)
  return {
    center,
    destroyedBlocks: blocks.destroyedBlocks,
    entityEffects: entities.entityEffects,
    limits,
    radius,
    seed,
    truncated: blocks.truncated || entities.truncated,
    visitedBlocks: blocks.visitedBlocks,
  }
}

export const applyExplosionPlan = (plan: ExplosionPlan, commit: ExplosionCommit): void => {
  commit({
    destroyedBlocks: plan.destroyedBlocks,
    entityEffects: plan.entityEffects,
  })
}
