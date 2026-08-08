/* eslint-disable id-length, no-magic-numbers, sort-imports */
import { describe, expect, it } from '@effect/vitest'
import {
  ARROW_AIR_DRAG,
  ARROW_MAX_LIFETIME_SECONDS,
  type Arrow,
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

  it('hits the top face of a platform approached from directly above', () => {
    // yaw 0 keeps the X component of velocity exactly 0 (sin(0) = 0), so the
    // segment test's X axis takes its "parallel to this axis" branch and
    // must fall through via `continue` rather than reject the box outright:
    // the arrow's X position sits inside the platform's wide X span.
    const arrow = launchArrow({ pitchRadians: 1.4, position: { x: 0.5, y: 5, z: 0.5 }, speed: 200, yawRadians: 0 })
    const platform: AABB = { maxX: 1000, maxY: 1, maxZ: 1000, minX: -1000, minY: 0, minZ: -1000 }
    const result = stepArrow(arrow, world({ blockBounds: () => [platform] }), 0.05)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 1, z: 0 } })
  })

  it('hits the near face of a wall approached along Z with no vertical or lateral motion', () => {
    // yaw 0 and pitch 0 keep both X (sin(yaw)) and, before gravity, Y exactly
    // 0; the wall's huge X/Y span means only Z can be the entering face.
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0.5, y: 0.5, z: 0.5 }, speed: 50, yawRadians: 0 })
    const wall: AABB = { maxX: 1000, maxY: 1000, maxZ: -1, minX: -1000, minY: -1000, minZ: -2 }
    const result = stepArrow(arrow, world({ blockBounds: () => [wall] }), 0.05)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 0, z: 1 } })
  })

  it('rejects a candidate box the flight path never crosses on an axis it does not move along', () => {
    // Same exactly-0 X delta as above, but now the box's X span excludes the
    // arrow's X position entirely, so the segment test must reject it via
    // the "parallel and out of range" branch instead of via `continue`.
    const arrow = launchArrow({ pitchRadians: 1.4, position: { x: 0.5, y: 5, z: 0.5 }, speed: 50, yawRadians: 0 })
    const outOfLine: AABB = { maxX: 6, maxY: 1, maxZ: 1000, minX: 5, minY: 0, minZ: -1000 }
    const result = stepArrow(arrow, world({ blockBounds: () => [outOfLine] }), 0.05)
    expect(result.hit).toBeUndefined()
  })

  it('hits the underside of a ledge approached from directly below', () => {
    // The mirror image of the "platform from above" test: a positive Y delta
    // (moving up) should give the opposite entering-face normal sign.
    const arrow = launchArrow({ pitchRadians: -1.4, position: { x: 0.5, y: -5, z: 0.5 }, speed: 200, yawRadians: 0 })
    const ledge: AABB = { maxX: 1000, maxY: 0, maxZ: 1000, minX: -1000, minY: -1, minZ: -1000 }
    const result = stepArrow(arrow, world({ blockBounds: () => [ledge] }), 0.05)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: -1, z: 0 } })
  })

  it('hits the far face of a wall approached along +Z', () => {
    // The mirror image of the "wall approached along Z" test: a positive Z
    // delta should give the opposite entering-face normal sign.
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0.5, y: 0.5, z: 0.5 }, speed: 50, yawRadians: Math.PI })
    const wall: AABB = { maxX: 1000, maxY: 1000, maxZ: 2, minX: -1000, minY: -1000, minZ: 1 }
    const result = stepArrow(arrow, world({ blockBounds: () => [wall] }), 0.05)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 0, z: -1 } })
  })

  it('rejects a candidate box whose per-axis entry windows do not all overlap', () => {
    // A genuine 3D miss: the X axis alone would enter the box's [0,1] window
    // at fraction 1/3, but the (near-stationary) Z axis's own window only
    // overlaps the box at fraction 5 — past the step's own far bound of 1 —
    // so the accumulated near/far range is empty before the loop even
    // reaches its per-axis-out-of-range or final-fraction checks.
    const drag = ARROW_AIR_DRAG ** 20
    const arrow: Arrow = {
      ageSeconds: 0,
      position: { x: -1, y: 0, z: 5 },
      state: 'flying',
      velocity: { x: 3 / drag, y: 0, z: -1 / drag },
    }
    const box: AABB = { maxX: 1, maxY: 1e6, maxZ: 1, minX: 0, minY: -1e6, minZ: 0 }
    const result = stepArrow(arrow, world({ blockBounds: () => [box] }), 1)
    expect(result.hit).toBeUndefined()
  })

  it('leaves an already-resolved arrow untouched instead of re-simulating it', () => {
    const stuck = stepArrow(
      launchArrow({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 }),
      world({ blockBounds: () => [{ maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }] }),
      0.05,
    ).arrow
    expect(stuck.state).toBe('stuck')
    const result = stepArrow(stuck, world({ blockBounds: () => [{ maxX: 3, maxY: 1, maxZ: 1, minX: -100, minY: -100, minZ: -100 }] }), 0.05)
    expect(result).toStrictEqual({ arrow: stuck })
  })

  it('despawns on a step whose displacement overflows to a non-finite position', () => {
    // A finite velocity so large that multiplying it by `dt` overflows a
    // double to Infinity — distinct from an already-non-finite input, which
    // the earlier guard already rejects.
    const arrow: Arrow = {
      ageSeconds: 0,
      position: { x: 0, y: 0, z: 0 },
      state: 'flying',
      velocity: { x: Number.MAX_VALUE, y: 0, z: 0 },
    }
    const result = stepArrow(arrow, world(), 2)
    expect(result.arrow).toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('hits entity AABBs and ignores the shooter only during grace', () => {
    const entity = { bounds: { maxX: 1, maxY: 1, maxZ: 1, minX: 0.5, minY: -1, minZ: -1 }, id: 'shooter' }
    const fresh = launchArrow({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, shooterId: 'shooter', speed: 20, yawRadians: -Math.PI / 2 })
    expect(stepArrow(fresh, world({ entities: [entity] }), 0.05).hit).toBeUndefined()
    const old = { ...fresh, ageSeconds: 0.3 }
    expect(stepArrow(old, world({ entities: [entity] }), 0.05).hit).toMatchObject({ entityId: 'shooter', kind: 'entity' })
  })

  it('picks the closer of two candidate blocks regardless of array order', () => {
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const farther: AABB = { maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }
    const closer: AABB = { maxX: 1.5, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }
    const result = stepArrow(arrow, world({ blockBounds: () => [farther, closer] }), 0.05)
    expect(result.hit).toMatchObject({ kind: 'block', point: { x: 1 } })
  })

  it('picks the closer of two candidate entities regardless of array order', () => {
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const farther = { bounds: { maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }, id: 'far' }
    const closer = { bounds: { maxX: 1.5, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }, id: 'near' }
    const result = stepArrow(arrow, world({ entities: [farther, closer] }), 0.05)
    expect(result.hit).toMatchObject({ entityId: 'near', kind: 'entity', point: { x: 1 } })
  })
})

describe('projectile boundaries', () => {
  it('despawns on invalid values, lifetime, and leaving the world', () => {
    expect(launchArrow({ pitchRadians: 0, position: { x: Number.NaN, y: 0, z: 0 }, speed: 1, yawRadians: 0 }).state).toBe('despawned')
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 10, yawRadians: -Math.PI / 2 })
    expect(stepArrow({ ...arrow, ageSeconds: ARROW_MAX_LIFETIME_SECONDS - 0.01 }, world(), 0.01).arrow).toMatchObject({ reason: 'lifetime', state: 'despawned' })
    expect(stepArrow(arrow, world({ bounds: { maxX: 0.1, maxY: 1, maxZ: 1, minX: -1, minY: -1, minZ: -1 } }), 0.05).arrow).toMatchObject({ reason: 'world', state: 'despawned' })
  })

  it('despawns a flying arrow given a non-positive or non-finite step, not just an invalid launch', () => {
    // `launchArrow` already rejects bad inputs at spawn; a still-flying arrow
    // must independently reject a bad `dt` handed to `stepArrow` later.
    const arrow = launchArrow({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 10, yawRadians: -Math.PI / 2 })
    expect(stepArrow(arrow, world(), 0).arrow).toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepArrow(arrow, world(), -1).arrow).toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepArrow(arrow, world(), Number.NaN).arrow).toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('keeps every finite boundary sample finite', () => {
    for (const dt of [Number.MIN_VALUE, 0.001, 0.05, 1]) {
      const result = stepArrow(launchArrow({ pitchRadians: -0.5, position: { x: 0, y: 10, z: 0 }, speed: 40, yawRadians: 1 }), world(), dt).arrow
      expect([result.position.x, result.position.y, result.position.z, result.velocity.x, result.velocity.y, result.velocity.z, result.ageSeconds].every(Number.isFinite)).toBe(true)
    }
  })
})
