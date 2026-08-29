/**
 * FR-010: elytra-style glide velocity update.
 *
 * `glideStep` only answers "one glide tick of velocity change" — whether an
 * entity IS gliding (elytra equipped, durability, grounded) is out of scope,
 * same division of labour `movement.test.ts` exercises for
 * `applyMovementInput` versus its caller's grounded check.
 */
import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import { DeltaTimeSecs, type Position } from '@nerima-games/mc-kernel'
import { position } from '../src/domain/coordinates'
import { GRAVITY_Y } from '../src/domain/integrate'
import {
  DEFAULT_GLIDE_CONFIG,
  GLIDE_DIVE_CONVERSION_PER_SECOND,
  GLIDE_HORIZONTAL_DRAG_PER_SECOND,
  glideStep,
  type GlideSight,
} from '../src/domain/glide'

const LEVEL: GlideSight = { pitchRadians: 0, yawRadians: 0 }
const DOWN: GlideSight = { pitchRadians: Math.PI / 6, yawRadians: 0 }
const UP: GlideSight = { pitchRadians: -Math.PI / 6, yawRadians: 0 }

const horizontalSpeed = (v: { x: number; z: number }): number => Math.hypot(v.x, v.z)

describe('glideStep', () => {
  it('gains speed when looking down (descent converts into forward speed)', () => {
    const before = position(0, 0, -1)
    const after = glideStep(before, DOWN, DeltaTimeSecs(0.5), DEFAULT_GLIDE_CONFIG)
    expect(horizontalSpeed(after)).toBeGreaterThan(horizontalSpeed(before))
  })

  it('descends more slowly than free fall when looking level', () => {
    const after = glideStep(position(0, 0, 0), LEVEL, DeltaTimeSecs(1), DEFAULT_GLIDE_CONFIG)
    expect(after.y).toBeLessThan(0)
    expect(Math.abs(after.y)).toBeLessThan(Math.abs(Number(GRAVITY_Y)))
  })

  it('loses horizontal speed and gains altitude when looking up', () => {
    const before = position(0, 0, -5)
    const after = glideStep(before, UP, DeltaTimeSecs(0.5), DEFAULT_GLIDE_CONFIG)
    expect(horizontalSpeed(after)).toBeLessThan(horizontalSpeed(before))
    expect(after.y).toBeGreaterThan(0)
  })

  it('turns the horizontal velocity gradually toward the look direction, not instantly', () => {
    // A moderate 45-degree turn: sharp enough to measure, not the antipodal
    // (180-degree) case, where a magnitude-preserving linear blend toward a
    // target recomputed from the still-turning vector collapses through zero
    // rather than tracing a turn.
    const sight: GlideSight = { pitchRadians: 0, yawRadians: -Math.PI / 4 }
    const lookAngle = Math.atan2(-Math.cos(sight.yawRadians), -Math.sin(sight.yawRadians))
    const normalize = (angle: number): number => (((angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
    const angleGapTo = (v: { x: number; z: number }): number => Math.abs(normalize(lookAngle - Math.atan2(v.z, v.x)))

    const before = position(5, 0, 0)
    const gapBefore = angleGapTo(before)

    const oneStep = glideStep(before, sight, DeltaTimeSecs(0.05), DEFAULT_GLIDE_CONFIG)
    const gapAfterOne = angleGapTo(oneStep)
    // Turned some...
    expect(gapAfterOne).toBeLessThan(gapBefore)
    // ...but not all the way in one 0.05s step.
    expect(gapAfterOne).toBeGreaterThan(gapBefore * 0.5)

    let body: Position = before
    for (let step = 0; step < 200; step += 1) {
      body = glideStep(body, sight, DeltaTimeSecs(0.05), DEFAULT_GLIDE_CONFIG)
    }
    // Given enough steps the gap keeps shrinking well past where one step left it.
    expect(angleGapTo(body)).toBeLessThan(gapAfterOne)
  })

  it('is deterministic: the same inputs always produce the same output', () => {
    const first = glideStep(position(1, -2, 3), DOWN, DeltaTimeSecs(0.3), DEFAULT_GLIDE_CONFIG)
    const second = glideStep(position(1, -2, 3), DOWN, DeltaTimeSecs(0.3), DEFAULT_GLIDE_CONFIG)
    expect(second).toStrictEqual(first)
  })

  it('sanitizes non-finite velocity, sight and config instead of propagating them', () => {
    const after = glideStep(
      position(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      { pitchRadians: Number.NaN, yawRadians: Number.POSITIVE_INFINITY },
      DeltaTimeSecs(0.1),
      {
        gravityPerSecondSquared: Number.NaN,
        liftCancelFactor: Number.POSITIVE_INFINITY,
        diveConversionPerSecond: Number.NEGATIVE_INFINITY,
        climbConversionPerSecond: Number.NaN,
        climbLiftMultiplier: Number.NaN,
        turnRatePerSecond: Number.NEGATIVE_INFINITY,
        horizontalDragPerSecond: Number.NaN,
        verticalDragPerSecond: Number.NaN,
      },
    )
    expect(Number.isFinite(after.x)).toBe(true)
    expect(Number.isFinite(after.y)).toBe(true)
    expect(Number.isFinite(after.z)).toBe(true)
  })

  it('property: finite inputs always produce finite outputs', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: 0, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        (vx, vy, vz, pitchRadians, yawRadians, dt) => {
          const after = glideStep(position(vx, vy, vz), { pitchRadians, yawRadians }, DeltaTimeSecs(dt), DEFAULT_GLIDE_CONFIG)
          return Number.isFinite(after.x) && Number.isFinite(after.y) && Number.isFinite(after.z)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('property: a zero delta is the identity', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: -10, max: 10, noNaN: true, noDefaultInfinity: true }),
        (vx, vy, vz, pitchRadians, yawRadians) => {
          const before = position(vx, vy, vz)
          const after = glideStep(before, { pitchRadians, yawRadians }, DeltaTimeSecs(0), DEFAULT_GLIDE_CONFIG)
          return after.x === before.x && after.y === before.y && after.z === before.z
        },
      ),
      { numRuns: 300 },
    )
  })

  it('property: diving repeatedly never exceeds the drag/dive fixed point — the conversion cannot compound', () => {
    FastCheck.assert(
      FastCheck.property(
        FastCheck.double({ min: 0.001, max: 0.05, noNaN: true, noDefaultInfinity: true }),
        FastCheck.double({ min: 0.05, max: Math.PI / 2 - 0.05, noNaN: true, noDefaultInfinity: true }),
        (dt, pitchRadians) => {
          const drag = Math.exp(-GLIDE_HORIZONTAL_DRAG_PER_SECOND * dt)
          const push = GLIDE_DIVE_CONVERSION_PER_SECOND * Math.sin(pitchRadians) * dt
          const fixedPoint = (drag * push) / (1 - drag)

          let body = position(0, 0, 0)
          for (let step = 0; step < 300; step += 1) {
            body = glideStep(body, { pitchRadians, yawRadians: 0 }, DeltaTimeSecs(dt), DEFAULT_GLIDE_CONFIG)
            if (horizontalSpeed(body) > fixedPoint + 1e-6) {
              return false
            }
          }
          return true
        },
      ),
      { numRuns: 100 },
    )
  })
})
