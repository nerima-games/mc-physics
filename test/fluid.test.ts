import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { DeltaTimeSecs, PositionAxis } from '@nerima-games/mc-kernel'
import {
  BlocksPerSecond,
  BlocksPerSecondSquared,
  CentreY,
  PerSecond,
  type Body,
  applyFluidMotion as applyFluidMotionResult,
  type FluidEffects,
  type FluidMotionCoefficients,
} from '../src/index'

const unwrapResult = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const applyFluidMotion = (...args: Parameters<typeof applyFluidMotionResult>): Body =>
  unwrapResult(applyFluidMotionResult(...args))

const bodyOf = (kind: Body['kind'] = 'dynamic'): Body => ({
  kind,
  x: PositionAxis(0),
  y: CentreY(1),
  z: PositionAxis(0),
  vx: BlocksPerSecond(2),
  vy: BlocksPerSecond(-1),
  vz: BlocksPerSecond(-3),
})

const effects: FluidEffects = { waterVolume: 0.5, lavaVolume: 0.25, flow: { x: 2, y: 7, z: -1 } }

const coefficients: FluidMotionCoefficients = {
  water: { dragPerSecond: PerSecond(2), buoyancyAcceleration: BlocksPerSecondSquared(3), flowAcceleration: BlocksPerSecondSquared(4) },
  lava: { dragPerSecond: PerSecond(4), buoyancyAcceleration: BlocksPerSecondSquared(5), flowAcceleration: BlocksPerSecondSquared(6) },
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

  it('sanitizes invalid volumes and flow components', () => {
    const actual = applyFluidMotion(
      bodyOf(),
      DeltaTimeSecs(0.5),
      { waterVolume: Number.POSITIVE_INFINITY, lavaVolume: -1, flow: { x: Number.NaN, y: Number.NaN, z: Number.POSITIVE_INFINITY } },
      {
        water: { dragPerSecond: PerSecond(0), buoyancyAcceleration: BlocksPerSecondSquared(0), flowAcceleration: BlocksPerSecondSquared(0) },
        lava: { dragPerSecond: PerSecond(0), buoyancyAcceleration: BlocksPerSecondSquared(0), flowAcceleration: BlocksPerSecondSquared(0) },
      },
    )
    expect(actual).toEqual(bodyOf())

    const invalidCoefficients: FluidMotionCoefficients = {
      ...coefficients,
      water: {
        ...coefficients.water,
        // @ts-expect-error Exercise runtime rejection of a malformed branded value.
        dragPerSecond: Number.NaN,
      },
    }
    expect(Result.isFailure(applyFluidMotionResult(bodyOf(), DeltaTimeSecs(0.5), effects, invalidCoefficients))).toBe(true)
  })

  it('handles zero duration and no fluid without changing velocity', () => {
    const empty: FluidEffects = { waterVolume: 0, lavaVolume: 0, flow: { x: 4, y: 5, z: 6 } }
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

  it('returns a failure for explicit null or invalid vertical drag instead of using isotropic drag', () => {
    for (const invalid of [null, Number.NaN]) {
      const invalidCoefficients: FluidMotionCoefficients = {
        ...coefficients,
        water: {
          ...coefficients.water,
          // @ts-expect-error Exercise runtime rejection of explicit null or NaN.
          dragPerSecondY: invalid,
        },
      }
      expect(Result.isFailure(applyFluidMotionResult(bodyOf(), DeltaTimeSecs(0.5), effects, invalidCoefficients))).toBe(true)
    }
  })

  it('applies a distinct vertical drag when dragPerSecondY is specified per fluid, independent of horizontal drag', () => {
    const anisotropic: FluidMotionCoefficients = {
      water: { dragPerSecond: PerSecond(2), dragPerSecondY: PerSecond(6), buoyancyAcceleration: BlocksPerSecondSquared(0), flowAcceleration: BlocksPerSecondSquared(0) },
      lava: { dragPerSecond: PerSecond(4), dragPerSecondY: PerSecond(8), buoyancyAcceleration: BlocksPerSecondSquared(0), flowAcceleration: BlocksPerSecondSquared(0) },
    }
    const seconds = 0.5
    const dragY = 0.5 * 6 + 0.25 * 8
    const multiplierY = Math.exp(-dragY * seconds)
    const dragXZ = 0.5 * 2 + 0.25 * 4
    const multiplierXZ = Math.exp(-dragXZ * seconds)
    const flowlessEffects: FluidEffects = { waterVolume: 0.5, lavaVolume: 0.25, flow: { x: 0, y: 0, z: 0 } }
    const actual = applyFluidMotion(bodyOf(), DeltaTimeSecs(seconds), flowlessEffects, anisotropic)
    expect(actual.vy).toBeCloseTo(-1 * multiplierY)
    expect(actual.vx).toBeCloseTo(2 * multiplierXZ)
    expect(actual.vz).toBeCloseTo(-3 * multiplierXZ)
  })

  it('property: a nonnegative dragPerSecondY never increases |vy| when buoyancy and flow are absent, and omitting it matches the isotropic drag exactly', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
        (dragPerSecond, dragPerSecondY, vy, seconds) => {
          const body = { ...bodyOf(), vy: BlocksPerSecond(vy) }
          const noFlow: FluidEffects = { waterVolume: 1, lavaVolume: 0, flow: { x: 0, y: 0, z: 0 } }
          const isotropicCoefficients: FluidMotionCoefficients = {
            water: { dragPerSecond: PerSecond(dragPerSecond), buoyancyAcceleration: BlocksPerSecondSquared(0), flowAcceleration: BlocksPerSecondSquared(0) },
            lava: { dragPerSecond: PerSecond(0), buoyancyAcceleration: BlocksPerSecondSquared(0), flowAcceleration: BlocksPerSecondSquared(0) },
          }
          const anisotropicCoefficients: FluidMotionCoefficients = {
            water: { dragPerSecond: PerSecond(dragPerSecond), dragPerSecondY: PerSecond(dragPerSecondY), buoyancyAcceleration: BlocksPerSecondSquared(0), flowAcceleration: BlocksPerSecondSquared(0) },
            lava: { dragPerSecond: PerSecond(0), buoyancyAcceleration: BlocksPerSecondSquared(0), flowAcceleration: BlocksPerSecondSquared(0) },
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
