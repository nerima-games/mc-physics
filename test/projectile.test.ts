/* eslint-disable id-length, no-magic-numbers, sort-imports */
import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import {
  ARROW_AIR_DRAG,
  ARROW_GRAVITY,
  ARROW_MAX_LIFETIME_SECONDS,
  ARROW_SHOOTER_GRACE_SECONDS,
  ARROW_WATER_DRAG,
  launchArrow,
  stepArrow,
  type Arrow,
  type ProjectileWorld as KernelProjectileWorld,
} from '@nerima-games/mc-kernel'
import {
  ARROW_PROFILE,
  EGG_PROFILE,
  SNOWBALL_PROFILE,
  TRIDENT_PROFILE,
  launchProjectile,
  stepProjectile,
  type Projectile,
  type ProjectileProfile,
  type ProjectileWorld,
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

const kernelPoint = (box: AABB): Readonly<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }> => ({
  max: { x: box.maxX, y: box.maxY, z: box.maxZ },
  min: { x: box.minX, y: box.minY, z: box.minZ },
})
const kernelWorld = (overrides: Partial<KernelProjectileWorld> = {}): KernelProjectileWorld => ({
  blockBounds: () => [],
  bounds: kernelPoint(bounds),
  entities: [],
  isInWater: () => false,
  ...overrides,
})

describe('FR-007 acceptance: ARROW_PROFILE reproduces the kernel Arrow implementation exactly', () => {
  it('matches the constants launchArrow/stepArrow are built from', () => {
    expect(ARROW_PROFILE).toStrictEqual({
      airDrag: ARROW_AIR_DRAG,
      gravity: ARROW_GRAVITY,
      maxLifetimeSeconds: ARROW_MAX_LIFETIME_SECONDS,
      shooterGraceSeconds: ARROW_SHOOTER_GRACE_SECONDS,
      waterDrag: ARROW_WATER_DRAG,
    })
  })

  it('matches launchArrow, including the invalid-launch despawn path', () => {
    const launches = [
      { pitchRadians: 0.37, position: { x: 1, y: 20, z: -3 }, shooterId: 'shooter', speed: 42, yawRadians: -1.1 },
      { pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 5, yawRadians: 0 },
      { pitchRadians: 0, position: { x: Number.NaN, y: 0, z: 0 }, speed: 1, yawRadians: 0 },
      { pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: -1, yawRadians: 0 },
    ]
    for (const launch of launches) {
      expect(launchProjectile(launch)).toStrictEqual(launchArrow(launch))
    }
  })

  it('matches stepArrow step-by-step across open flight, a block hit, and a shooter-grace entity hit', () => {
    const scenarios: ReadonlyArray<{
      launch: Parameters<typeof launchArrow>[0]
      blocks: readonly AABB[]
      entities: ReadonlyArray<{ id: string; bounds: AABB }>
      worldBounds: AABB
    }> = [
      {
        blocks: [],
        entities: [],
        launch: { pitchRadians: -0.2, position: { x: 0, y: 5, z: 0 }, speed: 30, yawRadians: 0.8 },
        worldBounds: { maxX: 8, maxY: 20, maxZ: 8, minX: -8, minY: -1, minZ: -8 },
      },
      {
        blocks: [{ maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }],
        entities: [],
        launch: { pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 },
        worldBounds: bounds,
      },
      {
        blocks: [],
        entities: [{ bounds: { maxX: 1, maxY: 1, maxZ: 1, minX: 0.5, minY: -1, minZ: -1 }, id: 'shooter' }],
        launch: { pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, shooterId: 'shooter', speed: 20, yawRadians: -Math.PI / 2 },
        worldBounds: bounds,
      },
    ]

    for (const scenario of scenarios) {
      let local: Projectile = launchProjectile(scenario.launch)
      let kernel: Arrow = launchArrow(scenario.launch)
      expect(local).toStrictEqual(kernel)

      const localWorld = world({ blockBounds: () => scenario.blocks, bounds: scenario.worldBounds, entities: scenario.entities })
      const kernelW = kernelWorld({
        blockBounds: () => scenario.blocks.map(kernelPoint),
        bounds: kernelPoint(scenario.worldBounds),
        entities: scenario.entities.map((entity) => ({ ...entity, bounds: kernelPoint(entity.bounds) })),
      })

      for (let step = 0; step < 40 && local.state === 'flying'; step += 1) {
        const localResult = stepProjectile(local, 0.05, localWorld, ARROW_PROFILE)
        const kernelResult = stepArrow(kernel, 0.05, kernelW)
        expect(localResult.projectile).toStrictEqual(kernelResult.arrow)
        expect(localResult.hit).toStrictEqual(kernelResult.hit)
        local = localResult.projectile
        kernel = kernelResult.arrow
      }
    }
  })

  it('matches stepArrow on the lifetime despawn boundary and under water drag', () => {
    const flying = { ageSeconds: ARROW_MAX_LIFETIME_SECONDS - 0.01, position: { x: 0, y: 0, z: 0 }, state: 'flying' as const, velocity: { x: 1, y: 0, z: 0 } }
    const lifetimeLocal = stepProjectile(flying, 0.01, world(), ARROW_PROFILE)
    const lifetimeKernel = stepArrow(flying, 0.01, kernelWorld())
    expect(lifetimeLocal.projectile).toStrictEqual(lifetimeKernel.arrow)
    expect(lifetimeLocal.hit).toStrictEqual(lifetimeKernel.hit)

    const wet = { ageSeconds: 0, position: { x: 0, y: 0, z: 0 }, state: 'flying' as const, velocity: { x: 10, y: 5, z: -10 } }
    const wetLocal = stepProjectile(wet, 0.05, world({ isInWater: () => true }), ARROW_PROFILE)
    const wetKernel = stepArrow(wet, 0.05, kernelWorld({ isInWater: () => true }))
    expect(wetLocal.projectile).toStrictEqual(wetKernel.arrow)
    expect(wetLocal.hit).toStrictEqual(wetKernel.hit)
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

  it('keeps the opposite face normal and ignores invalid candidate bounds', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 4, y: 0.5, z: 0.5 }, speed: 100, yawRadians: Math.PI / 2 })
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [{ maxX: 2, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 1, y: 0, z: 0 }, point: { x: 2 } })

    const noHit = stepProjectile(
      launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 10, yawRadians: -Math.PI / 2 }),
      0.05,
      world({ blockBounds: () => [{ maxX: Number.NaN, maxY: 1, maxZ: 1, minX: 0, minY: 0, minZ: 0 }] }),
      ARROW_PROFILE,
    )
    expect(noHit.hit).toBeUndefined()
    expect(noHit.projectile.state).toBe('flying')
  })

  it('hits the top face of a platform approached from directly above', () => {
    const projectile = launchProjectile({ pitchRadians: 1.4, position: { x: 0.5, y: 5, z: 0.5 }, speed: 200, yawRadians: 0 })
    const platform: AABB = { maxX: 1000, maxY: 1, maxZ: 1000, minX: -1000, minY: 0, minZ: -1000 }
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [platform] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 1, z: 0 } })
  })

  it('hits the near face of a wall approached along Z with no vertical or lateral motion', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0.5, y: 0.5, z: 0.5 }, speed: 50, yawRadians: 0 })
    const wall: AABB = { maxX: 1000, maxY: 1000, maxZ: -1, minX: -1000, minY: -1000, minZ: -2 }
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [wall] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 0, z: 1 } })
  })

  it('rejects a candidate box the flight path never crosses on an axis it does not move along', () => {
    const projectile = launchProjectile({ pitchRadians: 1.4, position: { x: 0.5, y: 5, z: 0.5 }, speed: 50, yawRadians: 0 })
    const outOfLine: AABB = { maxX: 6, maxY: 1, maxZ: 1000, minX: 5, minY: 0, minZ: -1000 }
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [outOfLine] }), ARROW_PROFILE)
    expect(result.hit).toBeUndefined()
  })

  it('hits the underside of a ledge approached from directly below', () => {
    const projectile = launchProjectile({ pitchRadians: -1.4, position: { x: 0.5, y: -5, z: 0.5 }, speed: 200, yawRadians: 0 })
    const ledge: AABB = { maxX: 1000, maxY: 0, maxZ: 1000, minX: -1000, minY: -1, minZ: -1000 }
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [ledge] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: -1, z: 0 } })
  })

  it('hits the far face of a wall approached along +Z', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0.5, y: 0.5, z: 0.5 }, speed: 50, yawRadians: Math.PI })
    const wall: AABB = { maxX: 1000, maxY: 1000, maxZ: 2, minX: -1000, minY: -1000, minZ: 1 }
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [wall] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', normal: { x: 0, y: 0, z: -1 } })
  })

  it('rejects a candidate box whose per-axis entry windows do not all overlap', () => {
    const drag = ARROW_PROFILE.airDrag ** 20
    const projectile: Projectile = {
      ageSeconds: 0,
      position: { x: -1, y: 0, z: 5 },
      state: 'flying',
      velocity: { x: 3 / drag, y: 0, z: -1 / drag },
    }
    const box: AABB = { maxX: 1, maxY: 1e6, maxZ: 1, minX: 0, minY: -1e6, minZ: 0 }
    const result = stepProjectile(projectile, 1, world({ blockBounds: () => [box] }), ARROW_PROFILE)
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
    const projectile: Projectile = {
      ageSeconds: 0,
      position: { x: 0, y: 0, z: 0 },
      state: 'flying',
      velocity: { x: Number.MAX_VALUE, y: 0, z: 0 },
    }
    const result = stepProjectile(projectile, 2, world(), ARROW_PROFILE)
    expect(result.projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
  })

  it('hits entity AABBs and ignores the shooter only during grace', () => {
    const entity = { bounds: { maxX: 1, maxY: 1, maxZ: 1, minX: 0.5, minY: -1, minZ: -1 }, id: 'shooter' }
    const fresh = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, shooterId: 'shooter', speed: 20, yawRadians: -Math.PI / 2 })
    expect(stepProjectile(fresh, 0.05, world({ entities: [entity] }), ARROW_PROFILE).hit).toBeUndefined()
    const old = { ...fresh, ageSeconds: 0.3 }
    expect(stepProjectile(old, 0.05, world({ entities: [entity] }), ARROW_PROFILE).hit).toMatchObject({ entityId: 'shooter', kind: 'entity' })
  })

  it('picks the closer of two candidate blocks regardless of array order', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const farther: AABB = { maxX: 3, maxY: 1, maxZ: 1, minX: 2, minY: 0, minZ: 0 }
    const closer: AABB = { maxX: 1.5, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }
    const result = stepProjectile(projectile, 0.05, world({ blockBounds: () => [farther, closer] }), ARROW_PROFILE)
    expect(result.hit).toMatchObject({ kind: 'block', point: { x: 1 } })
  })

  it('keeps an earlier block hit ahead of a later entity hit', () => {
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0.5, z: 0.5 }, speed: 100, yawRadians: -Math.PI / 2 })
    const block: AABB = { maxX: 1.5, maxY: 1, maxZ: 1, minX: 1, minY: 0, minZ: 0 }
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
    expect(launchProjectile({ pitchRadians: 0, position: { x: Number.NaN, y: 0, z: 0 }, speed: 1, yawRadians: 0 }).state).toBe('despawned')
    const projectile = launchProjectile({ pitchRadians: 0, position: { x: 0, y: 0, z: 0 }, speed: 10, yawRadians: -Math.PI / 2 })
    expect(stepProjectile({ ...projectile, ageSeconds: ARROW_PROFILE.maxLifetimeSeconds - 0.01 }, 0.01, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'lifetime', state: 'despawned' })
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
    expect(stepProjectile({ ...projectile, ageSeconds: Number.NaN }, 0.05, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepProjectile({ ...projectile, ageSeconds: -1 }, 0.05, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
    expect(stepProjectile({ ...projectile, ageSeconds: Number.MAX_VALUE }, Number.MAX_VALUE, world(), ARROW_PROFILE).projectile).toMatchObject({ reason: 'invalid', state: 'despawned' })
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
    const floor: AABB = { maxX: 10000, maxY: 0, maxZ: 10000, minX: -10000, minY: -10000, minZ: -10000 }
    const openBounds: AABB = { maxX: 10000, maxY: 10000, maxZ: 10000, minX: -10000, minY: -10000, minZ: -10000 }

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
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ max: 40, min: 1, noDefaultInfinity: true, noNaN: true }),
        FastCheck.double({ max: 40, min: 1, noDefaultInfinity: true, noNaN: true }),
        (gravityA, gravityB) => {
          const [gravityLow, gravityHigh] = gravityA <= gravityB ? [gravityA, gravityB] : [gravityB, gravityA]
          const launch = { pitchRadians: 0, position: { x: 0, y: 50, z: 0 }, speed: 0, yawRadians: 0 }
          const floor: AABB = { maxX: 1000, maxY: 0, maxZ: 1000, minX: -1000, minY: -1000, minZ: -1000 }
          const openBounds: AABB = { maxX: 1e6, maxY: 1e6, maxZ: 1e6, minX: -1e6, minY: -1e6, minZ: -1e6 }
          const testWorld = world({ blockBounds: () => [floor], bounds: openBounds })

          const timeToLand = (gravity: number): number => {
            const profile: ProjectileProfile = { ...ARROW_PROFILE, gravity }
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
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ max: 3, min: -3, noDefaultInfinity: true, noNaN: true }),
        FastCheck.double({ max: 1.5, min: -1.5, noDefaultInfinity: true, noNaN: true }),
        FastCheck.double({ max: 60, min: 0, noDefaultInfinity: true, noNaN: true }),
        FastCheck.array(FastCheck.double({ max: 0.1, min: 0.001, noDefaultInfinity: true, noNaN: true }), { maxLength: 20, minLength: 5 }),
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
