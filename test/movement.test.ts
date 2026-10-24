import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { AngleRadians, DeltaTimeSecs, PositionAxis } from '@nerima-games/mc-kernel'
import {
  BlocksPerSecond,
  BlocksPerSecondSquared,
  CentreY,
  applyKnockback as applyKnockbackResult,
  applyMovementInput as applyMovementInputResult,
  velocityVectorResult,
  type Body,
  type VelocityVector,
  type MovementConfig,
  type MovementInput,
} from '../src/index'

const unwrapResult = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const applyMovementInput = (...args: Parameters<typeof applyMovementInputResult>): Body =>
  unwrapResult(applyMovementInputResult(...args))

const applyKnockback = (body: Body, impulse: VelocityVector): Body =>
  unwrapResult(applyKnockbackResult(body, impulse))

const velocity = (x: number, y: number, z: number): VelocityVector =>
  unwrapResult(velocityVectorResult(x, y, z))

const bodyOf = (kind: Body['kind'] = 'dynamic'): Body => ({
  kind,
  x: PositionAxis(0),
  y: CentreY(1),
  z: PositionAxis(0),
  vx: BlocksPerSecond(0),
  vy: BlocksPerSecond(1),
  vz: BlocksPerSecond(0),
})

const inputOf = (overrides: Partial<MovementInput> = {}): MovementInput => ({
  forward: 1,
  strafe: 1,
  yawRadians: AngleRadians(0),
  sprint: true,
  sneak: false,
  jumpPressed: true,
  ...overrides,
})

const config: MovementConfig = {
  walkSpeed: BlocksPerSecond(4),
  sprintMultiplier: 2,
  sneakMultiplier: 0.3,
  groundAcceleration: BlocksPerSecondSquared(100),
  airAcceleration: BlocksPerSecondSquared(1),
  jumpVelocity: BlocksPerSecond(6),
  // Java: ~0.04 blocks/tick^2 swim-up accel x 20 ticks/s = 0.8 blocks/s^2.
  fluidAscentAcceleration: BlocksPerSecondSquared(0.8),
  // Java: ~0.2 blocks/tick swim-up cap x 20 ticks/s = 4 blocks/s.
  fluidAscentMaxSpeed: BlocksPerSecond(4),
}

describe('movement input', () => {
  it('normalizes diagonal input, rotates by yaw, sprints forward, and jumps from ground', () => {
    const diagonal = applyMovementInput(bodyOf(), inputOf(), true, false, DeltaTimeSecs(0.5), config)
    expect(diagonal.vx).toBeCloseTo(4 * Math.sqrt(2))
    expect(diagonal.vz).toBeCloseTo(-4 * Math.sqrt(2))
    expect(diagonal.vy).toBe(6)

    const rotated = applyMovementInput(
      bodyOf(),
      inputOf({ strafe: 0, yawRadians: AngleRadians(Math.PI / 2), jumpPressed: false }),
      true,
      false,
      DeltaTimeSecs(1),
      config,
    )
    expect(rotated.vx).toBeCloseTo(-8)
    expect(rotated.vz).toBeCloseTo(0)
    expect(rotated.vy).toBe(1)
  })

  it('applies sneak speed and gives sneak precedence over sprint', () => {
    const walking = applyMovementInput(
      bodyOf(),
      inputOf({ strafe: 0, sprint: false, sneak: false, jumpPressed: false }),
      true,
      false,
      DeltaTimeSecs(1),
      config,
    )
    const sprinting = applyMovementInput(
      bodyOf(),
      inputOf({ strafe: 0, sprint: true, sneak: false, jumpPressed: false }),
      true,
      false,
      DeltaTimeSecs(1),
      config,
    )
    const sneaking = applyMovementInput(
      bodyOf(),
      inputOf({ strafe: 0, sprint: true, sneak: true, jumpPressed: false }),
      true,
      false,
      DeltaTimeSecs(1),
      config,
    )

    expect(walking.vz).toBe(-4)
    expect(sprinting.vz).toBe(-8)
    expect(sneaking.vz).toBeCloseTo(-4 * config.sneakMultiplier)
  })

  it('uses air acceleration and does not sprint backward or jump while airborne', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vx: BlocksPerSecond(1), vz: BlocksPerSecond(1) },
      inputOf({ forward: -1, strafe: 0 }),
      false,
      false,
      DeltaTimeSecs(0.5),
      config,
    )
    expect(actual.vx).toBeCloseTo(0.5)
    expect(actual.vz).toBeCloseTo(1.5)
    expect(actual.vy).toBe(1)
  })

  it('approaches the target speed instead of changing velocity discontinuously', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vx: BlocksPerSecond(10), vz: BlocksPerSecond(0) },
      inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: false }),
      true,
      false,
      DeltaTimeSecs(0.1),
      { ...config, groundAcceleration: BlocksPerSecondSquared(2) },
    )
    expect(actual.vx).toBeCloseTo(9.8)
    expect(actual.vz).toBe(0)
  })

  it('does not cross zero when acceleration exactly cancels velocity', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vx: BlocksPerSecond(1) },
      inputOf({ forward: 0, strafe: -1, sprint: false, jumpPressed: false }),
      false,
      false,
      DeltaTimeSecs(0.5),
      { ...config, airAcceleration: BlocksPerSecondSquared(2) },
    )
    expect(actual.vx).toBe(0)
  })

  it('returns authored bodies unchanged and sanitizes invalid controls', () => {
    const staticBody = bodyOf('static')
    const kinematicBody = bodyOf('kinematic')
    expect(applyMovementInput(staticBody, inputOf(), true, false, DeltaTimeSecs(1), config)).toBe(staticBody)
    expect(applyMovementInput(kinematicBody, inputOf(), true, false, DeltaTimeSecs(1), config)).toBe(kinematicBody)

    // Every delta below is a legal `DeltaTimeSecs`; with zero ground
    // acceleration, malformed control axes leave the body unchanged.
    // The brand's own refusal of a non-finite delta is in test/delta-time.test.ts;
    // a delta that is not a `DeltaTimeSecs` cannot reach this signature at all.
    for (const seconds of [0, 0.001, 0.05, 30]) {
      const actual = applyMovementInput(
        bodyOf(),
        {
          forward: Number.NaN,
          strafe: Number.POSITIVE_INFINITY,
          // @ts-expect-error -- preserve a raw invalid angle to exercise control sanitization.
          yawRadians: Number.NaN,
          sprint: false,
          sneak: false,
          jumpPressed: false,
        },
        true,
        false,
        DeltaTimeSecs(seconds),
        {
          walkSpeed: BlocksPerSecond(-1),
          sprintMultiplier: Number.NaN,
          sneakMultiplier: Number.NaN,
          groundAcceleration: BlocksPerSecondSquared(0),
          airAcceleration: BlocksPerSecondSquared(-1),
          jumpVelocity: BlocksPerSecond(-1),
          fluidAscentAcceleration: BlocksPerSecondSquared(0),
          fluidAscentMaxSpeed: BlocksPerSecond(-1),
        },
      )
      expect(actual).toEqual(bodyOf())
    }

    const invalidConfig = { ...config, groundAcceleration: Number.NaN }
    expect(Result.isFailure(applyMovementInputResult(
      bodyOf(),
      inputOf(),
      true,
      false,
      DeltaTimeSecs(0.1),
      // @ts-expect-error -- preserve a raw invalid config value for boundary validation.
      invalidConfig,
    ))).toBe(true)
  })
})

describe('fluid ascent (FR-008: swimming upward)', () => {
  it('increases vy while jump is pressed in fluid, capped at fluidAscentMaxSpeed', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vy: BlocksPerSecond(0) },
      inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: true }),
      false,
      true,
      DeltaTimeSecs(0.5),
      config,
    )
    expect(actual.vy).toBeCloseTo(0.4)
  })

  it('caps vy at fluidAscentMaxSpeed even with a large deltaTime', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vy: BlocksPerSecond(0) },
      inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: true }),
      false,
      true,
      DeltaTimeSecs(10),
      config,
    )
    expect(actual.vy).toBe(config.fluidAscentMaxSpeed)
  })

  it('leaves vy unchanged in fluid when jump is not pressed', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vy: BlocksPerSecond(-1) },
      inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: false }),
      false,
      true,
      DeltaTimeSecs(0.5),
      config,
    )
    expect(actual.vy).toBe(-1)
  })

  it('leaves vy unchanged in the air when not in fluid, even with jump pressed', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vy: BlocksPerSecond(0.5) },
      inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: true }),
      false,
      false,
      DeltaTimeSecs(0.5),
      config,
    )
    expect(actual.vy).toBe(0.5)
  })

  it('keeps grounded jump behaviour exactly unchanged regardless of the fluid flag', () => {
    const onGround = applyMovementInput(
      { ...bodyOf(), vy: BlocksPerSecond(0) },
      inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: true }),
      true,
      true,
      DeltaTimeSecs(0.5),
      config,
    )
    expect(onGround.vy).toBe(config.jumpVelocity)
  })

  it('property: vy is monotonically non-decreasing and never exceeds max(initial vy, cap) while ascending in fluid', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
        (fluidAscentAcceleration, fluidAscentMaxSpeed, vy, seconds) => {
          const ascentConfig: MovementConfig = {
            ...config,
            fluidAscentAcceleration: BlocksPerSecondSquared(fluidAscentAcceleration),
            fluidAscentMaxSpeed: BlocksPerSecond(fluidAscentMaxSpeed),
          }
          const actual = applyMovementInput(
            { ...bodyOf(), vy: BlocksPerSecond(vy) },
            inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: true }),
            false,
            true,
            DeltaTimeSecs(seconds),
            ascentConfig,
          )
          return actual.vy >= vy - 1e-9 && actual.vy <= Math.max(vy, fluidAscentMaxSpeed) + 1e-9
        },
      ),
      { numRuns: 200 },
    )
  })
})

describe('knockback', () => {
  it('adds finite impulse components only to dynamic bodies', () => {
    expect(applyKnockback(bodyOf(), velocity(1, -2, 3))).toEqual({
      ...bodyOf(),
      vx: BlocksPerSecond(1),
      vy: BlocksPerSecond(-1),
      vz: BlocksPerSecond(3),
    })
    const invalidImpulse = {
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      z: Number.NEGATIVE_INFINITY,
    }
    expect(Result.isFailure(applyKnockbackResult(
      bodyOf(),
      // @ts-expect-error -- preserve raw invalid components for boundary validation.
      invalidImpulse,
    ))).toBe(true)
    const staticBody = bodyOf('static')
    expect(applyKnockback(staticBody, velocity(1, 2, 3))).toBe(staticBody)
  })
})
