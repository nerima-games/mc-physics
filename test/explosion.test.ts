import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXPLOSION_LIMITS,
  applyExplosionPlan,
  planExplosion,
  type ExplosionBlock,
  type ExplosionEntity,
  type ExplosionMutation,
} from '../src/index'

const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`
const emptyBlock: ExplosionBlock = { resistance: 0, destructible: true }

const world = (
  entries: ReadonlyArray<readonly [string, ExplosionBlock | undefined]> = [],
  fallback: ExplosionBlock | undefined = emptyBlock,
) => {
  const cells = new Map(entries)
  return ({ x, y, z }: { readonly x: number; readonly y: number; readonly z: number }) =>
    cells.has(keyOf(x, y, z)) ? cells.get(keyOf(x, y, z)) : fallback
}

const unloadedWorld = (entries: ReadonlyArray<readonly [string, ExplosionBlock | undefined]> = []) => {
  const cells = new Map(entries)
  return ({ x, y, z }: { readonly x: number; readonly y: number; readonly z: number }) =>
    cells.get(keyOf(x, y, z))
}

const entity = (id: string, x: number, y: number, z: number): ExplosionEntity => ({
  id,
  feetPosition: { x, y, z },
})

describe('explosion planning', () => {
  it('is deterministic and uses block resistance for destruction', () => {
    const request = {
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 2.5,
      seed: 11,
      blocks: world([
        [keyOf(1, 0, 0), { resistance: 100, destructible: true }],
      ]),
      entities: [],
    }

    const first = planExplosion(request)
    const second = planExplosion(request)
    const lowResistance = planExplosion({
      ...request,
      blocks: world([[keyOf(1, 0, 0), { resistance: -1, destructible: true }]]),
    })

    expect(first).toStrictEqual(second)
    expect(first.destroyedBlocks).not.toContainEqual({ x: 1, y: 0, z: 0 })
    expect(lowResistance.destroyedBlocks).toContainEqual({ x: 1, y: 0, z: 0 })
  })

  it('keeps non-destructible and unloaded cells out of the mutation', () => {
    const nonDestructible = planExplosion({
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 2,
      seed: 1,
      blocks: world([[keyOf(1, 0, 0), { resistance: 0, destructible: false }]]),
      entities: [],
    })
    expect(nonDestructible.destroyedBlocks).not.toContainEqual({ x: 1, y: 0, z: 0 })

    const unloadedRay = planExplosion({
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 2,
      seed: 1,
      blocks: unloadedWorld([[keyOf(1, 0, 0), emptyBlock]]),
      entities: [],
      limits: { maxRaySteps: 32 },
    })
    expect(unloadedRay.destroyedBlocks).toEqual([])
    expect(unloadedRay.truncated).toBe(false)
  })

  it('normalizes non-finite inputs and limits', () => {
    const normalized = planExplosion({
      center: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
      radius: Number.NaN,
      seed: Number.POSITIVE_INFINITY,
      blocks: world(),
      entities: [],
      limits: {
        maxVisitedBlocks: -2,
        maxRaySteps: Number.NaN,
        maxAffectedEntities: Number.POSITIVE_INFINITY,
      },
    })

    expect(normalized.center).toEqual({ x: 0, y: 0, z: 0 })
    expect(normalized.radius).toBe(0)
    expect(normalized.seed).toBe(0)
    expect(normalized.limits).toEqual({
      maxVisitedBlocks: 0,
      maxRaySteps: DEFAULT_EXPLOSION_LIMITS.maxRaySteps,
      maxAffectedEntities: DEFAULT_EXPLOSION_LIMITS.maxAffectedEntities,
    })
    expect(normalized.truncated).toBe(false)
  })

  it('marks visited-block and ray-step bounds as truncated', () => {
    const visitedLimit = planExplosion({
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 2,
      seed: 1,
      blocks: world(),
      entities: [],
      limits: { maxVisitedBlocks: 1 },
    })
    expect(visitedLimit.visitedBlocks).toBe(1)
    expect(visitedLimit.truncated).toBe(true)

    const rayLimit = planExplosion({
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 2,
      seed: 1,
      blocks: world(),
      entities: [],
      limits: { maxRaySteps: 1 },
    })
    expect(rayLimit.truncated).toBe(true)
  })

  it('uses cached radial traces for large explosions and respects shielding', () => {
    const request = {
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 16,
      seed: 11,
      blocks: world(),
      entities: [],
    }
    const open = planExplosion(request)
    const repeated = planExplosion(request)
    const shielded = planExplosion({
      ...request,
      blocks: world([
        [keyOf(4, 0, 0), { resistance: 20, destructible: true }],
        [keyOf(8, 0, 0), emptyBlock],
      ]),
    })

    expect(open).toStrictEqual(repeated)
    expect(open.destroyedBlocks).toContainEqual({ x: 8, y: 0, z: 0 })
    expect(shielded.destroyedBlocks).not.toContainEqual({ x: 8, y: 0, z: 0 })
  })

  it('handles unloaded radial prefixes and bounded large traces', () => {
    const sparse = planExplosion({
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 9,
      seed: 2,
      blocks: unloadedWorld([
        [keyOf(7, 0, 0), { resistance: 0, destructible: false }],
        [keyOf(8, 0, 0), emptyBlock],
      ]),
      entities: [],
    })
    expect(sparse.truncated).toBe(false)
    expect(sparse.destroyedBlocks).not.toContainEqual({ x: 8, y: 0, z: 0 })

    const rayLimited = planExplosion({
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 9,
      seed: 2,
      blocks: world(),
      entities: [],
      limits: { maxRaySteps: 1 },
    })
    expect(rayLimited.truncated).toBe(true)
  })

  it('plans exposed entity damage and handles center, out-of-range, and sparse entities', () => {
    const sparseEntities: ExplosionEntity[] = new Array(2)
    sparseEntities[1] = entity('near', 1, 0, 0)
    const plan = planExplosion({
      center: { x: 0, y: 0, z: 0 },
      radius: 4,
      seed: 3,
      blocks: world(),
      entities: [
        entity('center', 0, -0.9, 0),
        ...sparseEntities,
        entity('far', 10, 0, 0),
      ],
      limits: { maxAffectedEntities: 4 },
    })

    expect(plan.entityEffects.map(({ id }) => id)).toEqual(['center', 'near'])
    expect(plan.entityEffects[0]?.knockback).toEqual({ x: 0, y: 0, z: 0 })
    expect(plan.entityEffects[0]?.damage).toBeGreaterThan(1)
    expect(plan.entityEffects[1]?.exposure).toBeGreaterThan(0)
    expect(plan.truncated).toBe(false)

    const limited = planExplosion({
      center: { x: 0, y: 0, z: 0 },
      radius: 4,
      seed: 3,
      blocks: world(),
      entities: [entity('first', 0, -0.9, 0), entity('second', 1, 0, 0)],
      limits: { maxAffectedEntities: 1 },
    })
    expect(limited.entityEffects).toHaveLength(1)
    expect(limited.truncated).toBe(true)

    const zeroRadius = planExplosion({
      center: { x: 0, y: 0, z: 0 },
      radius: 0,
      seed: 3,
      blocks: world(),
      entities: [entity('center', 0, -0.9, 0)],
    })
    expect(zeroRadius.entityEffects).toEqual([])
  })

  it('omits fully occluded entity effects and commits one mutation', () => {
    const plan = planExplosion({
      center: { x: 0.5, y: 0.5, z: 0.5 },
      radius: 4,
      seed: 4,
      blocks: unloadedWorld(),
      entities: [entity('occluded', 1, 0, 0)],
    })
    expect(plan.entityEffects).toEqual([])

    let mutation: ExplosionMutation | undefined
    applyExplosionPlan(plan, (next) => {
      mutation = next
    })
    expect(mutation).toEqual({
      destroyedBlocks: plan.destroyedBlocks,
      entityEffects: plan.entityEffects,
    })
  })
})
