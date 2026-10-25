/* eslint-disable id-length, no-magic-numbers, sort-imports */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { Result } from 'effect'
import {
  AngleRadians,
  DeltaTimeSecs,
  EntityId,
  FixedDurationSecs,
  PositionAxis,
  type Position,
  position,
} from '@nerima-games/mc-kernel'
import {
  BlocksPerSecond,
  BlocksPerSecondSquared,
  type VelocityVector,
  velocityVectorResult,
} from '../src/domain/physical-units'
import {
  ARROW_PROFILE,
  EGG_PROFILE,
  SNOWBALL_PROFILE,
  TRIDENT_PROFILE,
  launchProjectile as rawLaunchProjectile,
  stepProjectile as rawStepProjectile,
  type Projectile,
  type ProjectileProfile,
  type ProjectileWorld,
} from '../src/domain/projectile'
import type { AABB } from '../src/domain/coordinates'

type NumericPosition = Readonly<{ x: number; y: number; z: number }>
type NumericAABB = Readonly<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }>
type NumericWorldOverrides = Readonly<{
  blockBounds?: (start: Position, end: Position) => readonly NumericAABB[]
  bounds?: NumericAABB
  entities?: readonly Readonly<{ id: string; bounds: NumericAABB }>[]
  isInWater?: (position: Position) => boolean
}>

const unwrap = <Value, Error>(result: Result.Result<Value, Error>): Value => {
  if (Result.isFailure(result)) throw new Error('Expected a branded test value')
  return result.success
}

const axis = (value: number): PositionAxis => unwrap(PositionAxis.result(value))
const positionOf = (value: NumericPosition): Position => position(axis(value.x), axis(value.y), axis(value.z))
const box = (value: NumericAABB): AABB => ({
  minX: axis(value.minX),
  minY: axis(value.minY),
  minZ: axis(value.minZ),
  maxX: axis(value.maxX),
  maxY: axis(value.maxY),
  maxZ: axis(value.maxZ),
})
// @ts-expect-error -- malformed numeric bounds must reach projectile validation unchanged.
const rawBox = (value: NumericAABB): AABB => value
const entityId = (value: string) => unwrap(EntityId.result(value))
const velocity = (x: number, y: number, z: number): VelocityVector =>
  unwrap(velocityVectorResult(x, y, z))
const age = (value: number) => unwrap(FixedDurationSecs.result(value))

const world = (overrides: NumericWorldOverrides = {}): ProjectileWorld => ({
  blockBounds: (start, end) => (overrides.blockBounds?.(start, end) ?? []).map(box),
  bounds: box(overrides.bounds ?? { maxX: 100, maxY: 100, maxZ: 100, minX: -100, minY: -100, minZ: -100 }),
  entities: (overrides.entities ?? []).map((entity) => ({ id: entityId(entity.id), bounds: box(entity.bounds) })),
  isInWater: overrides.isInWater ?? (() => false),
})

const launchProjectile = (launch: Readonly<{
  pitchRadians: number
  position: NumericPosition
  speed: number
  yawRadians: number
  shooterId?: string
}>) => rawLaunchProjectile({
  pitchRadians: unwrap(AngleRadians.result(launch.pitchRadians)),
  position: positionOf(launch.position),
  ...(launch.shooterId === undefined ? {} : { shooterId: entityId(launch.shooterId) }),
  speed: unwrap(BlocksPerSecond.result(launch.speed)),
  yawRadians: unwrap(AngleRadians.result(launch.yawRadians)),
})

const stepProjectile = (state: Projectile, dt: number, flightWorld: ProjectileWorld, profile: ProjectileProfile) => {
  const checkedDelta = DeltaTimeSecs.result(dt)
  if (Result.isSuccess(checkedDelta)) {
    return rawStepProjectile(state, checkedDelta.success, flightWorld, profile)
  }
  // @ts-expect-error -- malformed raw deltas exercise projectile boundary validation.
  return rawStepProjectile(state, dt, flightWorld, profile)
}

const flight = (value: Readonly<{ age?: number; position: NumericPosition; velocity: NumericPosition }>): Projectile => ({
  ageSeconds: age(value.age ?? 0),
  position: positionOf(value.position),
  state: 'flying',
  velocity: velocity(value.velocity.x, value.velocity.y, value.velocity.z),
})

const withAge = (projectile: Projectile, seconds: number): Projectile => {
  const checkedAge = FixedDurationSecs.result(seconds)
  if (Result.isSuccess(checkedAge)) return { ...projectile, ageSeconds: checkedAge.success }
  // @ts-expect-error -- malformed raw ages exercise projectile state validation.
  return { ...projectile, ageSeconds: seconds }
}

describe('projectile profile, trajectory, and collision contracts', () => {
  it('keeps the arrow profile at the mc-physics contract values', () => {
    expect(ARROW_PROFILE).toStrictEqual({
      airDrag: 0.99,
      gravity: 9.81,
      maxLifetimeSeconds: 60,
      shooterGraceSeconds: 0.25,
      waterDrag: 0.6,
    })
  })

  it('advances an unobstructed trajectory with drag and gravity', () => {
    const launch = launchProjectile({
      pitchRadians: 0,
      position: { x: 0, y: 10, z: 0 },
      speed: 10,
      yawRadians: -Math.PI / 2,
    })
    const result = stepProjectile(launch, 0.05, world(), ARROW_PROFILE)
    const expectedVy = -ARROW_PROFILE.gravity * 0.05 * ARROW_PROFILE.airDrag

    expect(launch.velocity.x).toBeCloseTo(10, 12)
    expect(launch.velocity.z).toBeCloseTo(0, 12)
    expect(result.projectile.velocity.x).toBeCloseTo(9.9, 12)
    expect(result.projectile.velocity.y).toBeCloseTo(expectedVy, 12)
    expect(result.projectile.position.x).toBeCloseTo(0.495, 12)
    expect(result.projectile.position.y).toBeCloseTo(10 + expectedVy * 0.05, 12)
    expect(result.projectile.ageSeconds).toBeCloseTo(0.05, 12)
    expect(result.hit).toBeUndefined()
  })

  it('stops at the first block face and records the local contact contract', () => {
    const launch = launchProjectile({
      pitchRadians: 0,
      position: { x: 0, y: 0, z: 0 },
      speed: 20,
      yawRadians: -Math.PI / 2,
    })
    const wall = box({ maxX: 2, maxY: 1, maxZ: 1, minX: 1, minY: -1, minZ: -1 })
    const result = stepProjectile(launch, 0.1, world({ blockBounds: () => [wall] }), ARROW_PROFILE)

    expect(result.hit).toMatchObject({
      kind: 'block',
      normal: { x: -1, y: 0, z: 0 },
      point: { x: 1 },
    })
    expect(result.hit?.point.y).toBeCloseTo(-0.04905, 12)
    expect(result.hit?.point.z).toBeCloseTo(0, 12)
    expect(result.hit?.flightTimeSeconds).toBeGreaterThan(0)
    expect(result.hit?.flightTimeSeconds).toBeLessThan(0.1)
    expect(result.projectile.state).toBe('stuck')
  })
})
describe('projectile launch and integration', () => {
  it('derives velocity from yaw and pitch and applies gravity and air/water drag', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 5, z: 0 }, speed: 10, yawRadians: 0 })
    expect(projectile.velocity.z).toBeCloseTo(-10)
    const air = stepProjectile(projectile, 0.05, world(), ARROW_PROFILE).projectile
    const water = stepProjectile(projectile, 0.05, world({ isInWater: () => true }), ARROW_PROFILE).projectile
    expect(air.velocity.y).toBeLessThan(0)
    expect(Math.abs(water.velocity.z)).toBeLessThan(Math.abs(air.velocity.z))
  })
})

describe('continuous projectile collisions', () => {
  it('returns the exact first block face hit and flight time without tunnelling', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [{ maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: -1, y: 0, z: 0 }, point: { x: 2 } })
    expect(result.projectile).toMatchObject({ recoverable: true, state: 'stuck', velocity: { x: 0, y: 0, z: 0 } })
    expect(result.hit?.flightTimeSeconds).toBeGreaterThan(0)
    expect(result.hit?.flightTimeSeconds).toBeLessThan(0.05)
  })

  it('keeps the opposite face normal and despawns on invalid candidate bounds', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 4, y: 0.5, z: 0.5 }, speed: 100, yawRadians: Math.PI / 2 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [{ maxX: 2, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 1, y: 0, z: 0 }, point: { x: 2 } })

    const invalidFlight = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 10, yawRadians: -Math.PI / 2 })
    const invalidBlockBoxes = [
      rawBox({ maxX: Number.NaN, maxY: 1, maxZ: 1, minX: 0, minY: 0, minZ: 0 }),
      rawBox({ maxX: 0, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }),
    ]
    const invalidEntityBoxes = [
      rawBox({ maxX: Number.NaN, maxY: 1, maxZ: 1, minX: 0, minY: 0, minZ: 0 }),
      rawBox({ maxX: 0, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }),
    ]

    for (const bounds of invalidBlockBoxes) {
      const invalidBlockWorld: ProjectileWorld = { ...world(), blockBounds: () => [bounds] }
      const despawned = stepProjectile(invalidFlight, 0.05, invalidBlockWorld, ARROW_PROFILE)
      expect(despawned.hit).toBeUndefined()
      expect(despawned.projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
    }
    for (const bounds of invalidEntityBoxes) {
      const invalidEntityWorld: ProjectileWorld = {
        ...world(),
        entities: [{ bounds, id: entityId('invalid-bounds') }],
      }
      const despawned = stepProjectile(invalidFlight, 0.05, invalidEntityWorld, ARROW_PROFILE)
      expect(despawned.hit).toBeUndefined()
      expect(despawned.projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
    }
  })

  it('hits the top face of a platform approached from directly above', () => {
    const projectile = launchProjectile({ pitchRadians: 1.4, position: { x: 0.5, y: 5, z: 0.5 }, speed: 200, yawRadians: 0 })
    const platform = box({ maxX: 1000, maxY: 1, maxZ: 1000, minX: -1000, minY: 0, minZ: -1000 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [platform] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 1, z: 0 } })
  })

  it('hits the near face of a wall approached along Z with no vertical or lateral motion', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0.5, y: 0.5, z: 0.5 }, speed: 50, yawRadians: 0 })
    const wall = box({ maxX: 1000, maxY: 1000, maxZ: -1, minX: -1000, minY: -1000, minZ: -2 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [wall] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 0, z: 1 } })
  })

  it('rejects a candidate box the flight path never crosses on an axis it does not move along', () => {
    const projectile = launchProjectile({ pitchRadians: 1.4, position: { x: 0.5, y: 5, z: 0.5 }, speed: 50, yawRadians: 0 })
    const outOfLine = box({ maxX: 6, maxY: 1, maxZ: 1000, minX: 5, minY: 0, minZ: -1000 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [outOfLine] }), ARROW_PROFILE)
    expect(result.hit).toBeUndefined()
  })

  it('hits the underside of a ledge approached from directly below', () => {
    const projectile = launchProjectile({ pitchRadians: -1.4, position: { x: 0.5, y: -5, z: 0.5 }, speed: 200, yawRadians: 0 })
    const ledge = box({ maxX: 1000, maxY: 0, maxZ: 1000, minX: -1000, minY: -1, minZ: -1000 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [ledge] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: -1, z: 0 } })
  })

  it('hits the far face of a wall approached along +Z', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0.5, y: 0.5, z: 0.5 }, speed: 50, yawRadians: Math.PI })
    const wall = box({ maxX: 1000, maxY: 1000, maxZ: 2, minX: -1000, minY: -1000, minZ: 1 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [wall] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 0, z: -1 } })
  })

  it('rejects a candidate box whose per-axis entry windows do not all overlap', () => {
    const drag = ARROW_PROFILE.airDrag ** 20
    const projectile = flight({ position: { x: -1, y: 0, z: 5 }, velocity: { x: 3 / drag, y: 0, z: -1 / drag } })
    const candidateBox = box({ maxX: 1, maxY: 1e6, maxZ: 1, minX: 0, minY: -1e6, minZ: 0 })
    const result = stepProjectile(projectile, 1, world({ blockBounds: () => [candidateBox] }), ARROW_PROFILE)
    expect(result.hit).toBeUndefined()
  })

  it('leaves an already-resolved projectile untouched instead of re-simulating it', () => {
    const stuck = stepProjectile(
      launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 }),
      0.05,
      world({ blockBounds: () => [{ maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }] }),
      ARROW_PROFILE,
    ).projectile
    expect(stuck.state).toBe('stuck')
    const result = stepProjectile(stuck, 0.05, world({ blockBounds: () => [{ maxX: 3, maxY: 1, maxZ: 1, minX: -100, minY: -100, minZ: -100 }] }), ARROW_PROFILE)
    expect(result).toStrictEqual({ projectile: stuck })
  })

  it('despawns on a step whose displacement overflows to a non-finite position', () => {
    const projectile = flight({ position: { x: 0, y: 0, z: 0 }, velocity: { x: Number.MAX_VALUE, y: 0, z: 0 } })
    const result = stepProjectile(projectile, 2, world(), ARROW_PROFILE)
    expect(result.projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('hits entity AABBs and ignores the shooter only during grace', () => {
    const entity = { bounds: { maxX: 1, maxY: 1, maxZ: 1, minX: 0.5, minY: -1, minZ: -1 }, id: 'shooter' }
    const fresh = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, shooterId: 'shooter', speed: 20, yawRadians: -Math.PI / 2 })
    expect(stepProjectile(fresh, 0.05, world({ entities: [entity] }), ARROW_PROFILE).hit).toBeUndefined()
    const old = withAge(fresh, 0.3)
    expect(stepProjectile(old, 0.05, world({ entities: [entity] }), ARROW_PROFILE).hit).toMatchObject({ entityId: 'shooter', kind: 'entity' })
  })

  it('picks the closer of two candidate blocks regardless of array order', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const farther = box({ maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 })
    const closer = box({ maxX: 1.5, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [farther, closer] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', point: { x: 1 } })
  })

  it('keeps an earlier block hit ahead of a later entity hit', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const block = box({ maxX: 1.5, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 })
    const entity = { bounds: { maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }, id: 'later' }
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [block], entities: [entity] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', point: { x: 1 } })
  })

  it('picks the closer of two candidate entities regardless of array order', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const farther = { bounds: { maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }, id: 'far' }
    const closer = { bounds: { maxX: 1.5, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }, id: 'near' }
    const result = stepProjectile(projectile, 0.05, world({ entities: [farther, closer] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ entityId: 'near', kind: 'entity', point: { x: 1 } })
  })
})

describe('projectile boundaries', () => {
  it('despawns on invalid values, lifetime, and leaving the world', () => {
    const invalidPosition = { x: Number.NaN, y: PositionAxis(0), z: PositionAxis(0) }
    const invalidLaunch = {
      pitchRadians: AngleRadians(0),
      position: invalidPosition,
      speed: BlocksPerSecond(1),
      yawRadians: AngleRadians(0),
    }
    // @ts-expect-error -- malformed coordinates exercise launch boundary validation.
    expect(rawLaunchProjectile(invalidLaunch).state).toBe('despawned')
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 10, yawRadians: -Math.PI / 2 })
    expect(stepProjectile(withAge(projectile, ARROW_PROFILE.maxLifetimeSeconds - 0.01), 0.01, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'lifetime', state: 'despawned' })
    expect(stepProjectile(projectile, 0.05, world({ bounds: { maxX: 0.1, maxY: 1, maxZ: 1, minX: -1, minY: -1, minZ: -1 } }), ARROW_PROFILE).projectile).toMatchObject({ reason: 'world', state: 'despawned' })
  })

  it('despawns a flying projectile given a non-positive or non-finite step, not just an invalid launch', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 10, yawRadians: -Math.PI / 2 })
    expect(stepProjectile(projectile, 0, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepProjectile(projectile, -1, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepProjectile(projectile, Number.NaN, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('rejects malformed or overflowing projectile ages as invalid state', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 10, yawRadians: -Math.PI / 2 })
    expect(stepProjectile(withAge(projectile, Number.NaN), 0.05, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepProjectile(withAge(projectile, -1), 0.05, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepProjectile(withAge(projectile, Number.MAX_VALUE), Number.MAX_VALUE, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('keeps every finite boundary sample finite', () => {
    for (const dt of [Number.MIN_VALUE, 0.001, 0.05, 1]) {
      const result = stepProjectile(launchProjectile({ pitchRadians: -0.5, position: { x: 0, y: 10, z: 0 }, speed: 40, yawRadians: 1 }), dt, world(), ARROW_PROFILE).projectile
      expect([result.position.x, result.position.y, result.position.z, result.velocity.x, result.velocity.y, result.velocity.z, result.ageSeconds].every(Number.isFinite)).toBe(true)
    }
  })
})

describe('FR-007 per-profile behaviour', () => {
  it('gives EGG_PROFILE the same values as SNOWBALL_PROFILE, both weaker-gravity than ARROW_PROFILE', () => {
    expect(EGG_PROFILE).toStrictEqual(SNOWBALL_PROFILE)
    expect(SNOWBALL_PROFILE.gravity).toBeLessThan(ARROW_PROFILE.gravity)
    expect(SNOWBALL_PROFILE.airDrag).toBe(ARROW_PROFILE.airDrag)
    expect(SNOWBALL_PROFILE.maxLifetimeSeconds).toBe(ARROW_PROFILE.maxLifetimeSeconds)
    expect(SNOWBALL_PROFILE.shooterGraceSeconds).toBe(ARROW_PROFILE.shooterGraceSeconds)
  })

  it('gives TRIDENT_PROFILE the same gravity as ARROW_PROFILE but far weaker water drag', () => {
    expect(TRIDENT_PROFILE.gravity).toBe(ARROW_PROFILE.gravity)
    expect(TRIDENT_PROFILE.waterDrag).toBeGreaterThan(ARROW_PROFILE.waterDrag)
  })

  it('SNOWBALL_PROFILE has weaker gravity than ARROW_PROFILE, so the same launch travels farther before landing', () => {
    const launch = { pitchRadians: -0.15, position: { x: 0, y: 10, z: 0 }, speed: 20, yawRadians: 0 }
    const floor = box({ maxX: 10000, maxY: 0, maxZ: 10000, minX: -10000, minY: -10000, minZ: -10000 })
    const openBounds = box({ maxX: 10000, maxY: 10000, maxZ: 10000, minX: -10000, minY: -10000, minZ: -10000 })

    const distanceToLanding = (profile: ProjectileProfile): number => {
      let state = launchProjectile(launch)
      const testWorld = world({ blockBounds: () => [floor], bounds: openBounds })
      for (let step = 0; step < 2000 && state.state === 'flying'; step += 1) {
        state = stepProjectile(state, 0.05, testWorld, profile).projectile
      }
      if (state.state !== 'stuck') {throw new Error('expected the projectile to land on the floor')}
      return Math.hypot(state.position.x - launch.position.x, state.position.z - launch.position.z)
    }

    expect(distanceToLanding(SNOWBALL_PROFILE)).toBeGreaterThan(distanceToLanding(ARROW_PROFILE))
  })

  it('property: within otherwise-identical profiles, larger gravity reaches a floor no later than smaller gravity', () => {
    fc.assert(
      fc.property(
        fc.double({ max: 40, min: 1, noDefaultInfinity: true, noNaN: true }),
        fc.double({ max: 40, min: 1, noDefaultInfinity: true, noNaN: true }),
        (gravityA, gravityB) => {
          const [gravityLow, gravityHigh] = gravityA <= gravityB ? [gravityA, gravityB] : [gravityB, gravityA]
          const launch = { pitchRadians: 0, position: { x: 0, y: 50, z: 0 }, speed: 0, yawRadians: 0 }
          const floor = box({ maxX: 1000, maxY: 0, maxZ: 1000, minX: -1000, minY: -1000, minZ: -1000 })
          const openBounds = box({ maxX: 1e6, maxY: 1e6, maxZ: 1e6, minX: -1e6, minY: -1e6, minZ: -1e6 })
          const testWorld = world({ blockBounds: () => [floor], bounds: openBounds })

          const timeToLand = (gravity: number): number => {
            const profile: ProjectileProfile = {
              ...ARROW_PROFILE,
              gravity: unwrap(BlocksPerSecondSquared.result(gravity)),
            }
            let state = launchProjectile(launch)
            for (let step = 0; step < 5000 && state.state === 'flying'; step += 1) {
              state = stepProjectile(state, 0.02, testWorld, profile).projectile
            }
            return state.state === 'stuck' ? state.hit.flightTimeSeconds : Number.POSITIVE_INFINITY
          }

          return timeToLand(gravityHigh) <= timeToLand(gravityLow)
        },
      ),
      { numRuns: 30 },
    )
  })
})

describe('determinism', () => {
  it('property: the same launch and step sequence always produces the same trajectory', () => {
    fc.assert(
      fc.property(
        fc.double({ max: 3, min: -3, noDefaultInfinity: true, noNaN: true }),
        fc.double({ max: 1.5, min: -1.5, noDefaultInfinity: true, noNaN: true }),
        fc.double({ max: 60, min: 0, noDefaultInfinity: true, noNaN: true }),
        fc.array(fc.double({ max: 0.1, min: 0.001, noDefaultInfinity: true, noNaN: true }), { maxLength: 20, minLength: 5 }),
        (yawRadians, pitchRadians, speed, steps) => {
          const launch = { pitchRadians, position: { x: 0, y: 30, z: 0 }, speed, yawRadians }
          const run = (): Projectile => {
            let state = launchProjectile(launch)
            for (const dt of steps) {
              if (state.state !== 'flying') {break}
              state = stepProjectile(state, dt, world(), ARROW_PROFILE).projectile
            }
            return state
          }
          expect(run()).toStrictEqual(run())
          return true
        },
      ),
      { numRuns: 50 },
    )
  })
})

describe('projectile invalid-state propagation', () => {
  it('despawns a launch with an invalid shooter id', () => {
    const projectile = rawLaunchProjectile({
      pitchRadians: AngleRadians(0),
      position: positionOf({ x: 0, y: 0, z: 0 }),
      // @ts-expect-error -- malformed entity ids exercise launch boundary validation.
      shooterId: '',
      speed: BlocksPerSecond(1),
      yawRadians: AngleRadians(0),
    })

    expect(projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('despawns when world bounds are malformed or inverted', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 1, yawRadians: 0 })
    const malformedBounds = {
      ...world(),
      bounds: rawBox({ maxX: Number.NaN, maxY: 100, maxZ: 100, minX: -100, minY: -100, minZ: -100 }),
    }
    const invertedBounds = world({
      bounds: { maxX: -1, maxY: 100, maxZ: 100, minX: 1, minY: -100, minZ: -100 },
    })

    expect(stepProjectile(projectile, 0.05, malformedBounds, ARROW_PROFILE).projectile)
      .toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepProjectile(projectile, 0.05, invertedBounds, ARROW_PROFILE).projectile)
      .toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('despawns when finite gravity and dt overflow the vertical velocity calculation', () => {
    const projectile = flight({
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    })
    const profile: ProjectileProfile = {
      ...ARROW_PROFILE,
      airDrag: 1,
      gravity: BlocksPerSecondSquared(Number.MAX_VALUE),
      maxLifetimeSeconds: FixedDurationSecs(10),
      waterDrag: 1,
    }

    expect(stepProjectile(projectile, 2, world(), profile).projectile)
      .toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('despawns when a finite displacement makes the next position unrepresentable', () => {
    const projectile = flight({
      position: { x: Number.MAX_VALUE * 0.75, y: 0, z: 0 },
      velocity: { x: Number.MAX_VALUE * 0.5, y: 0, z: 0 },
    })
    const profile: ProjectileProfile = { ...ARROW_PROFILE, airDrag: 1, gravity: BlocksPerSecondSquared(0), waterDrag: 1 }

    expect(stepProjectile(projectile, 1, world(), profile).projectile)
      .toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('propagates an invalid entity id as an invalid despawn', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 1, yawRadians: 0 })
    const invalidEntityWorld: ProjectileWorld = {
      ...world(),
      entities: [{
        // @ts-expect-error -- malformed entity ids exercise world validation.
        id: '',
        bounds: box({ maxX: 2, maxY: 2, maxZ: 2, minX: 1, minY: 1, minZ: 1 }),
      }],
    }

    expect(stepProjectile(projectile, 0.05, invalidEntityWorld, ARROW_PROFILE).projectile)
      .toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('keeps flying when a valid entity box does not intersect the projectile segment', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 20, yawRadians: -Math.PI / 2 })
    const offPathEntity = {
      bounds: { maxX: 1, maxY: 3, maxZ: 1, minX: 0.5, minY: 2, minZ: 0 },
      id: 'above-path',
    }
    const result = stepProjectile(projectile, 0.05, world({ entities: [offPathEntity] }), ARROW_PROFILE)

    expect(result.hit).toBeUndefined()
    expect(result.projectile.state).toBe('flying')
  })

  it('despawns a launch when its kinematic brands fail validation', () => {
    const projectile = rawLaunchProjectile({
      pitchRadians: AngleRadians(0),
      position: positionOf({ x: 0, y: 0, z: 0 }),
      speed: BlocksPerSecond(1),
      // @ts-expect-error -- a raw invalid angle exercises launch boundary validation.
      yawRadians: Number.NaN,
    })

    expect(projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
  })
})
