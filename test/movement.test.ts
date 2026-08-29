import { describe, expect, it } from 'vitest'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  CentreY,
  type Body,
  applyKnockback,
  applyMovementInput,
  vec3,
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
}

describe('movement input', () => {
  it('normalizes diagonal input, rotates by yaw, sprints forward, and jumps from ground', () => {
    const diagonal = applyMovementInput(bodyOf(), inputOf(), true, DeltaTimeSecs(0.5), config)
    expect(diagonal.vx).toBeCloseTo(4 * Math.sqrt(2))
    expect(diagonal.vz).toBeCloseTo(-4 * Math.sqrt(2))
    expect(diagonal.vy).toBe(6)

    const rotated = applyMovementInput(
      bodyOf(),
      inputOf({ strafe: 0, yawRadians: Math.PI / 2, jumpPressed: false }),
      true,
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
      DeltaTimeSecs(0.5),
      { ...config, airAcceleration: 2 },
    )
    expect(actual.vx).toBe(0)
  })

  it('returns authored bodies unchanged and sanitizes invalid controls', () => {
    const staticBody = bodyOf('static')
    const kinematicBody = bodyOf('kinematic')
    expect(applyMovementInput(staticBody, inputOf(), true, DeltaTimeSecs(1), config)).toBe(staticBody)
    expect(applyMovementInput(kinematicBody, inputOf(), true, DeltaTimeSecs(1), config)).toBe(kinematicBody)

    const actual = applyMovementInput(
      bodyOf(),
      { forward: Number.NaN, strafe: Number.POSITIVE_INFINITY, yawRadians: Number.NaN, sprint: false, jumpPressed: false },
      true,
      Number.NaN as never,
      { walkSpeed: -1, sprintMultiplier: Number.NaN, groundAcceleration: Number.NaN, airAcceleration: -1, jumpVelocity: Number.NaN },
    )
    expect(actual).toEqual(bodyOf())
  })
})

describe('knockback', () => {
  it('adds finite impulse components only to dynamic bodies', () => {
    expect(applyKnockback(bodyOf(), vec3(1, -2, 3))).toEqual({ ...bodyOf(), vx: 1, vy: -1, vz: 3 })
    expect(applyKnockback(bodyOf(), vec3(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY))).toEqual(bodyOf())
    const staticBody = bodyOf('static')
    expect(applyKnockback(staticBody, vec3(1, 2, 3))).toBe(staticBody)
  })
})
