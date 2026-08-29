import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  CentreY,
  type Body,
  applyKnockback,
  applyMovementInput,
  position,
  type MovementConfig,
  type MovementInput,
} from '../src/index'

const bodyOf = (kind: Body['kind'] = 'dynamic'): Body => ({
  kind,
  x: 0,
  y: CentreY(1),
  z: 0,
  vx: 0,
  vy: 1,
  vz: 0,
})

const inputOf = (overrides: Partial<MovementInput> = {}): MovementInput => ({
  forward: 1,
  strafe: 1,
  yawRadians: 0,
  sprint: true,
  jumpPressed: true,
  ...overrides,
})

const config: MovementConfig = {
  walkSpeed: 4,
  sprintMultiplier: 2,
  groundAcceleration: 100,
  airAcceleration: 1,
  jumpVelocity: 6,
  // Java: ~0.04 blocks/tick^2 swim-up accel x 20 ticks/s = 0.8 blocks/s^2.
  fluidAscentAcceleration: 0.8,
  // Java: ~0.2 blocks/tick swim-up cap x 20 ticks/s = 4 blocks/s.
  fluidAscentMaxSpeed: 4,
}

describe('movement input', () => {
  it('normalizes diagonal input, rotates by yaw, sprints forward, and jumps from ground', () => {
    const diagonal = applyMovementInput(bodyOf(), inputOf(), true, false, DeltaTimeSecs(0.5), config)
    expect(diagonal.vx).toBeCloseTo(4 * Math.sqrt(2))
    expect(diagonal.vz).toBeCloseTo(-4 * Math.sqrt(2))
    expect(diagonal.vy).toBe(6)

    const rotated = applyMovementInput(
      bodyOf(),
      inputOf({ strafe: 0, yawRadians: Math.PI / 2, jumpPressed: false }),
      true,
      false,
      DeltaTimeSecs(1),
      config,
    )
    expect(rotated.vx).toBeCloseTo(-8)
    expect(rotated.vz).toBeCloseTo(0)
    expect(rotated.vy).toBe(1)
  })

  it('uses air acceleration and does not sprint backward or jump while airborne', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vx: 1, vz: 1 },
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
      { ...bodyOf(), vx: 10, vz: 0 },
      inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: false }),
      true,
      false,
      DeltaTimeSecs(0.1),
      { ...config, groundAcceleration: 2 },
    )
    expect(actual.vx).toBeCloseTo(9.8)
    expect(actual.vz).toBe(0)
  })

  it('does not cross zero when acceleration exactly cancels velocity', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vx: 1 },
      inputOf({ forward: 0, strafe: -1, sprint: false, jumpPressed: false }),
      false,
      false,
      DeltaTimeSecs(0.5),
      { ...config, airAcceleration: 2 },
    )
    expect(actual.vx).toBe(0)
  })

  it('returns authored bodies unchanged and sanitizes invalid controls', () => {
    const staticBody = bodyOf('static')
    const kinematicBody = bodyOf('kinematic')
    expect(applyMovementInput(staticBody, inputOf(), true, false, DeltaTimeSecs(1), config)).toBe(staticBody)
    expect(applyMovementInput(kinematicBody, inputOf(), true, false, DeltaTimeSecs(1), config)).toBe(kinematicBody)

    const actual = applyMovementInput(
      bodyOf(),
      { forward: Number.NaN, strafe: Number.POSITIVE_INFINITY, yawRadians: Number.NaN, sprint: false, jumpPressed: false },
      true,
      false,
      Number.NaN as never,
      {
        walkSpeed: -1,
        sprintMultiplier: Number.NaN,
        groundAcceleration: Number.NaN,
        airAcceleration: -1,
        jumpVelocity: Number.NaN,
        fluidAscentAcceleration: Number.NaN,
        fluidAscentMaxSpeed: -1,
      },
    )
    expect(actual).toEqual(bodyOf())
  })
})

describe('fluid ascent (FR-008: swimming upward)', () => {
  it('increases vy while jump is pressed in fluid, capped at fluidAscentMaxSpeed', () => {
    const actual = applyMovementInput(
      { ...bodyOf(), vy: 0 },
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
      { ...bodyOf(), vy: 0 },
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
      { ...bodyOf(), vy: -1 },
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
      { ...bodyOf(), vy: 0.5 },
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
      { ...bodyOf(), vy: 0 },
      inputOf({ forward: 0, strafe: 0, sprint: false, jumpPressed: true }),
      true,
      true,
      DeltaTimeSecs(0.5),
      config,
    )
    expect(onGround.vy).toBe(config.jumpVelocity)
  })

  it('property: vy is monotonically non-decreasing and never exceeds max(initial vy, cap) while ascending in fluid', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
        (fluidAscentAcceleration, fluidAscentMaxSpeed, vy, seconds) => {
          const ascentConfig: MovementConfig = { ...config, fluidAscentAcceleration, fluidAscentMaxSpeed }
          const actual = applyMovementInput(
            { ...bodyOf(), vy },
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
    expect(applyKnockback(bodyOf(), position(1, -2, 3))).toEqual({ ...bodyOf(), vx: 1, vy: -1, vz: 3 })
    expect(applyKnockback(bodyOf(), position(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY))).toEqual(bodyOf())
    const staticBody = bodyOf('static')
    expect(applyKnockback(staticBody, position(1, 2, 3))).toBe(staticBody)
  })
})
