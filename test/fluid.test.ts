import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  CentreY,
  type Body,
  applyFluidMotion,
  position,
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

const effects: FluidEffects = { waterVolume: 0.5, lavaVolume: 0.25, flow: position(2, 7, -1) }

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
      { waterVolume: Number.POSITIVE_INFINITY, lavaVolume: -1, flow: position(Number.NaN, Number.NaN, Number.POSITIVE_INFINITY) },
      {
        water: { dragPerSecond: Number.NaN, buoyancyAcceleration: -1, flowAcceleration: 4 },
        lava: { dragPerSecond: 1, buoyancyAcceleration: 1, flowAcceleration: 1 },
      },
    )
    expect(actual).toEqual(bodyOf())
  })

  it('handles zero duration and no fluid without changing velocity', () => {
    const empty: FluidEffects = { waterVolume: 0, lavaVolume: 0, flow: position(4, 5, 6) }
    expect(applyFluidMotion(bodyOf(), DeltaTimeSecs(0), empty, coefficients)).toEqual(bodyOf())
  })
})

describe('vertical fluid drag (FR-006: anisotropic lava/water drag)', () => {
  it('falls back to the isotropic dragPerSecond for vy when dragPerSecondY is omitted, matching pre-FR-006 behaviour', () => {
    const seconds = 0.5
    const drag = 0.5 * 2 + 0.25 * 4
    const multiplier = Math.exp(-drag * seconds)
    const buoyancy = 0.5 * 3 + 0.25 * 5
    const flowAcceleration = 0.5 * 4 + 0.25 * 6
    const actual = applyFluidMotion(bodyOf(), DeltaTimeSecs(seconds), effects, coefficients)
    expect(actual.vy).toBeCloseTo(-1 * multiplier + buoyancy * seconds + 7 * flowAcceleration * seconds)
  })

  it('applies a distinct vertical drag when dragPerSecondY is specified per fluid, independent of horizontal drag', () => {
    const anisotropic: FluidMotionCoefficients = {
      water: { dragPerSecond: 2, dragPerSecondY: 6, buoyancyAcceleration: 0, flowAcceleration: 0 },
      lava: { dragPerSecond: 4, dragPerSecondY: 8, buoyancyAcceleration: 0, flowAcceleration: 0 },
    }
    const seconds = 0.5
    const dragY = 0.5 * 6 + 0.25 * 8
    const multiplierY = Math.exp(-dragY * seconds)
    const dragXZ = 0.5 * 2 + 0.25 * 4
    const multiplierXZ = Math.exp(-dragXZ * seconds)
    const flowlessEffects: FluidEffects = { waterVolume: 0.5, lavaVolume: 0.25, flow: position(0, 0, 0) }
    const actual = applyFluidMotion(bodyOf(), DeltaTimeSecs(seconds), flowlessEffects, anisotropic)
    expect(actual.vy).toBeCloseTo(-1 * multiplierY)
    expect(actual.vx).toBeCloseTo(2 * multiplierXZ)
    expect(actual.vz).toBeCloseTo(-3 * multiplierXZ)
  })

  it('property: a nonnegative dragPerSecondY never increases |vy| when buoyancy and flow are absent, and omitting it matches the isotropic drag exactly', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
        (dragPerSecond, dragPerSecondY, vy, seconds) => {
          const body = { ...bodyOf(), vy }
          const noFlow: FluidEffects = { waterVolume: 1, lavaVolume: 0, flow: position(0, 0, 0) }
          const isotropicCoefficients: FluidMotionCoefficients = {
            water: { dragPerSecond, buoyancyAcceleration: 0, flowAcceleration: 0 },
            lava: { dragPerSecond: 0, buoyancyAcceleration: 0, flowAcceleration: 0 },
          }
          const anisotropicCoefficients: FluidMotionCoefficients = {
            water: { dragPerSecond, dragPerSecondY, buoyancyAcceleration: 0, flowAcceleration: 0 },
            lava: { dragPerSecond: 0, buoyancyAcceleration: 0, flowAcceleration: 0 },
          }
          const isotropic = applyFluidMotion(body, DeltaTimeSecs(seconds), noFlow, isotropicCoefficients)
          const anisotropic = applyFluidMotion(body, DeltaTimeSecs(seconds), noFlow, anisotropicCoefficients)
          const expectedIsotropicVy = body.vy * Math.exp(-dragPerSecond * seconds)
          return (
            Math.abs(anisotropic.vy) <= Math.abs(vy) + 1e-9 &&
            Math.abs(isotropic.vy - expectedIsotropicVy) < 1e-9
          )
        },
      ),
      { numRuns: 200 },
    )
  })
})
