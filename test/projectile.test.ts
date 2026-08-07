/* eslint-disable id-length, no-magic-numbers, sort-imports */
import { describe, expect, it } from '@effect/vitest'
import {
  ARROW_MAX_LIFETIME_SECONDS,
  type ProjectileWorld,
  launchArrow,
  stepArrow,
} from '../src/domain/projectile'
import type { AABB } from '../src/domain/coordinates'

const bounds: AABB = { maxX: 100, maxY: 100, maxZ: 100, minX: -100, minY: -100, minZ: -100 }
const world = (overrides: Partial<ProjectileWorld> = {}): ProjectileWorld => ({
  blockBounds: () => [],
  bounds,
  entities: [],
  isInWater: () => false,
  ...overrides,
})

describe('arrow launch and integration', () => {
  it('derives velocity from yaw and pitch and applies gravity and air/water drag', () => {
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0, y: 5, z: 0 }, speed: 10, yawRadians: 0 })
    expect(arrow.velocity.z).toBeCloseTo(-10)
    const air = stepArrow(arrow, world(), 0.05).arrow
    const water = stepArrow(arrow, world({ isInWater: () => true }), 0.05).arrow
    expect(air.velocity.y).toBeLessThan(0)
    expect(Math.abs(water.velocity.z)).toBeLessThan(Math.abs(air.velocity.z))
  })
})

describe('continuous projectile collisions', () => {
  it('returns the exact first block face hit and flight time without tunnelling', () => {
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const result = stepArrow(arrow, world({ blockBounds: () => [{ maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }] }), 0.05)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: -1, y: 0, z: 0 }, point: { x: 2 } })
    expect(result.arrow).toMatchObject({ recoverable: true, state: 'stuck', velocity: { x: 0, y: 0, z: 0 } })
    expect(result.hit?.flightTimeSeconds).toBeGreaterThan(0)
    expect(result.hit?.flightTimeSeconds).toBeLessThan(0.05)
  })

  it('keeps the opposite face normal and ignores invalid candidate bounds', () => {
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 4, y: 0.5, z: 0.5 }, speed: 100, yawRadians: Math.PI / 2 })
    const result = stepArrow(arrow, world({ blockBounds: () => [{ maxX: 2, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }] }), 0.05)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 1, y: 0, z: 0 }, point: { x: 2 } })

    const noHit = stepArrow(launchArrow({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 10, yawRadians: -Math.PI / 2 }), world({
      blockBounds: () => [{ maxX: Number.NaN, maxY: 1, maxZ: 1, minX: 0, minY: 0, minZ: 0 }],
    }), 0.05)
    expect(noHit.hit).toBeUndefined()
    expect(noHit.arrow.state).toBe('flying')
  })

  it('hits entity AABBs and ignores the shooter only during grace', () => {
    const entity = { bounds: { maxX: 1, maxY: 1, maxZ: 1, minX: 0.5, minY: -1, minZ: -1 }, id: 'shooter' }
    const fresh = launchArrow({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, shooterId: 'shooter', speed: 20, yawRadians: -Math.PI / 2 })
    expect(stepArrow(fresh, world({ entities: [entity] }), 0.05).hit).toBeUndefined()
    const old = { ...fresh, ageSeconds: 0.3 }
    expect(stepArrow(old, world({ entities: [entity] }), 0.05).hit).toMatchObject({ entityId: 'shooter', kind: 'entity' })
  })
})

describe('projectile boundaries', () => {
  it('despawns on invalid values, lifetime, and leaving the world', () => {
    expect(launchArrow({ pitchRadians: 0, position: { x: Number.NaN, y: 0, z: 0 }, speed: 1, yawRadians: 0 }).state).toBe('despawned')
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 10, yawRadians: -Math.PI / 2 })
    expect(stepArrow({ ...arrow, ageSeconds: ARROW_MAX_LIFETIME_SECONDS - 0.01 }, world(), 0.01).arrow).toMatchObject({ reason: 'lifetime', state: 'despawned' })
    expect(stepArrow(arrow, world({ bounds: { maxX: 0.1, maxY: 1, maxZ: 1, minX: -1, minY: -1, minZ: -1 } }), 0.05).arrow).toMatchObject({ reason: 'world', state: 'despawned' })
  })

  it('keeps every finite boundary sample finite', () => {
    for (const dt of [Number.MIN_VALUE, 0.001, 0.05, 1]) {
      const result = stepArrow(launchArrow({ pitchRadians: -0.5, position: { x: 0, y: 10, z: 0 }, speed: 40, yawRadians: 1 }), world(), dt).arrow
      expect([result.position.x, result.position.y, result.position.z, result.velocity.x, result.velocity.y, result.velocity.z, result.ageSeconds].every(Number.isFinite)).toBe(true)
    }
  })
})
