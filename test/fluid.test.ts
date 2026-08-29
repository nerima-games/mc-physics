import { describe, expect, it } from 'vitest'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  CentreY,
  type Body,
  applyFluidMotion,
  vec3,
  type FluidEffects,
  type FluidMotionCoefficients,
} from '../src/index'

const bodyOf = (kind: Body['kind'] = 'dynamic'): Body => ({
  kind,
  x: 0,
  y: CentreY(1),
  z: 0,
  vx: 2,
  vy: -1,
  vz: -3,
})

const effects: FluidEffects = { waterVolume: 0.5, lavaVolume: 0.25, flow: vec3(2, 7, -1) }

const coefficients: FluidMotionCoefficients = {
  water: { dragPerSecond: 2, buoyancyAcceleration: 3, flowAcceleration: 4 },
  lava: { dragPerSecond: 4, buoyancyAcceleration: 5, flowAcceleration: 6 },
}

describe('fluid motion', () => {
  it('applies weighted drag, buoyancy, and flow to dynamic bodies', () => {
    const seconds = 0.5
    const drag = 0.5 * 2 + 0.25 * 4
    const buoyancy = 0.5 * 3 + 0.25 * 5
    const flowAcceleration = 0.5 * 4 + 0.25 * 6
    const multiplier = Math.exp(-drag * seconds)
    const actual = applyFluidMotion(bodyOf(), DeltaTimeSecs(seconds), effects, coefficients)
    expect(actual.vx).toBeCloseTo(2 * multiplier + 2 * flowAcceleration * seconds)
    expect(actual.vy).toBeCloseTo(-1 * multiplier + buoyancy * seconds + 7 * flowAcceleration * seconds)
    expect(actual.vz).toBeCloseTo(-3 * multiplier - flowAcceleration * seconds)
  })

  it('leaves authored bodies unchanged', () => {
    const staticBody = bodyOf('static')
    const kinematicBody = bodyOf('kinematic')
    expect(applyFluidMotion(staticBody, DeltaTimeSecs(0.5), effects, coefficients)).toBe(staticBody)
    expect(applyFluidMotion(kinematicBody, DeltaTimeSecs(0.5), effects, coefficients)).toBe(kinematicBody)
  })

  it('sanitizes invalid time, volumes, coefficients, and flow components', () => {
    const actual = applyFluidMotion(
      bodyOf(),
      DeltaTimeSecs(0.5),
      { waterVolume: Number.POSITIVE_INFINITY, lavaVolume: -1, flow: vec3(Number.NaN, Number.NaN, Number.POSITIVE_INFINITY) },
      {
        water: { dragPerSecond: Number.NaN, buoyancyAcceleration: -1, flowAcceleration: 4 },
        lava: { dragPerSecond: 1, buoyancyAcceleration: 1, flowAcceleration: 1 },
      },
    )
    expect(actual).toEqual(bodyOf())
  })

  it('handles zero duration and no fluid without changing velocity', () => {
    const empty: FluidEffects = { waterVolume: 0, lavaVolume: 0, flow: vec3(4, 5, 6) }
    expect(applyFluidMotion(bodyOf(), DeltaTimeSecs(0), empty, coefficients)).toEqual(bodyOf())
  })
})
