/**
 * The deltaTime clamp: how a raw wall-clock delta gets mapped into the
 * integrator's safe range, and the invariants that boundary is supposed to
 * guarantee. Split out of test/integrate.test.ts (FR-016) — see that file
 * for the integration tests this clamp feeds.
 *
 * Regression names (docs/design-notes.md):
 *   physics-delta-clamp-is-exact
 *   physics-first-frame-delta
 */
import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import {
  DeltaTimeSecs,
  FIRST_FRAME_DELTA_SECS,
  MAX_DELTA_SECS,
  MIN_DELTA_SECS,
  clampFrameDelta,
  deltaTimeBetween,
  isClampedDelta,
} from '../src/domain/delta-time'

describe('the deltaTime clamp', () => {
  it('clamps elapsed time between validated monotonic readings', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (previous, current) => {
          const delta = deltaTimeBetween(previous, current)
          if (Result.isFailure(delta)) return false
          const elapsed = current - previous
          return delta.success === Math.min(Math.max(MIN_DELTA_SECS, elapsed), MAX_DELTA_SECS)
        },
      ),
      { numRuns: 500 },
    )
  })

  it('uses the first-frame delta when there is no previous timestamp', () => {
    const delta = deltaTimeBetween(undefined, 12345)
    expect(Result.isSuccess(delta)).toBe(true)
    if (Result.isSuccess(delta)) expect(delta.success).toBe(FIRST_FRAME_DELTA_SECS)
  })

  it('maps a long interval and a backwards reading to the frame limits', () => {
    const longFrame = deltaTimeBetween(0, 30)
    const backwardsFrame = deltaTimeBetween(10, 9)
    expect(Result.isSuccess(longFrame)).toBe(true)
    expect(Result.isSuccess(backwardsFrame)).toBe(true)
    if (Result.isSuccess(longFrame)) expect(longFrame.success).toBe(MAX_DELTA_SECS)
    if (Result.isSuccess(backwardsFrame)) expect(backwardsFrame.success).toBe(MIN_DELTA_SECS)
  })

  it('returns validation failures for invalid clock readings without throwing', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(Result.isFailure(deltaTimeBetween(undefined, value))).toBe(true)
      expect(Result.isFailure(deltaTimeBetween(value, 10))).toBe(true)
    }
  })

  it('uses the kernel DeltaTimeSecs brand and keeps the integrator range explicit', () => {
    expect(DeltaTimeSecs(0)).toBe(0)
    expect(DeltaTimeSecs(FIRST_FRAME_DELTA_SECS)).toBe(FIRST_FRAME_DELTA_SECS)
    expect(DeltaTimeSecs(MAX_DELTA_SECS)).toBe(MAX_DELTA_SECS)
    expect(DeltaTimeSecs(30)).toBe(30)
    expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
    expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
    expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()

    expect(isClampedDelta(DeltaTimeSecs(30))).toBe(false)
    expect(isClampedDelta(DeltaTimeSecs(0))).toBe(false)
    expect(isClampedDelta(DeltaTimeSecs(MIN_DELTA_SECS))).toBe(true)
    expect(isClampedDelta(DeltaTimeSecs(MAX_DELTA_SECS))).toBe(true)
    expect(isClampedDelta(DeltaTimeSecs(FIRST_FRAME_DELTA_SECS))).toBe(true)
  })

  it('clamps an already-validated raw frame delta at the boundary', () => {
    const rawDelta = DeltaTimeSecs.result(30)
    expect(Result.isSuccess(rawDelta)).toBe(true)
    if (Result.isSuccess(rawDelta)) expect(clampFrameDelta(rawDelta.success)).toBe(MAX_DELTA_SECS)
    expect(clampFrameDelta(DeltaTimeSecs(0))).toBe(MIN_DELTA_SECS)
  })
})
