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
import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import {
  DeltaTimeSecs,
  FIRST_FRAME_DELTA_SECS,
  MAX_DELTA_SECS,
  MIN_DELTA_SECS,
  clampDeltaTime,
  deltaTimeBetween,
  isClampedDelta,
} from '../src/domain/delta-time'

describe('the deltaTime clamp', () => {
  it('is exactly min(max(0.001, raw), 0.05)', () => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
          (raw) => clampDeltaTime(raw) === Math.min(Math.max(MIN_DELTA_SECS, raw), MAX_DELTA_SECS),
        ),
        { numRuns: 500 },
      )
  })

  it('caps a backgrounded tab at 0.05s instead of teleporting everything through the floor', () => {
      expect(clampDeltaTime(30)).toBe(MAX_DELTA_SECS)
      expect(clampDeltaTime(Number.POSITIVE_INFINITY)).toBe(MAX_DELTA_SECS)
  })

  it('floors a zero, negative or backwards-clock delta at 0.001s', () => {
      expect(clampDeltaTime(0)).toBe(MIN_DELTA_SECS)
      expect(clampDeltaTime(-5)).toBe(MIN_DELTA_SECS)
      expect(clampDeltaTime(Number.NEGATIVE_INFINITY)).toBe(MIN_DELTA_SECS)
  })

  it('maps NaN to the first-frame delta rather than letting it poison every position', () => {
      expect(clampDeltaTime(Number.NaN)).toBe(FIRST_FRAME_DELTA_SECS)
  })

  it('uses 0.016s for the first frame, where there is no previous timestamp to subtract', () => {
      expect(deltaTimeBetween(undefined, 12345)).toBe(FIRST_FRAME_DELTA_SECS)
      expect(deltaTimeBetween(10, 10.02)).toBeCloseTo(0.02, 12)
  })

  // REGRESSION: this brand is `Brand.Brand<'DeltaTimeSecs'>`, and a brand is
  // keyed by that STRING — so kernel's `DeltaTimeSecs`
  // (mc-kernel/domain/quantities.ts:37-42) and this one are the same type to
  // TypeScript no matter how differently they validate. This declaration used
  // to refine to [0.001, 0.05] while kernel refines to "finite, non-negative",
  // which meant a kernel-constructed `DeltaTimeSecs(30)` typechecked as an
  // argument to `integrateBody` while breaking the invariant its comment
  // claimed. The refinement is now kernel's, exactly.
  it('REGRESSION: the brand is kernel’s refinement — finite and non-negative, zero included', () => {
      // A zero delta is LEGAL: kernel's note says a frame may be scheduled
      // twice inside one clock tick. Stages handle it; the brand does not
      // reject it.
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(FIRST_FRAME_DELTA_SECS)).toBe(FIRST_FRAME_DELTA_SECS)
      expect(DeltaTimeSecs(MAX_DELTA_SECS)).toBe(MAX_DELTA_SECS)
      // Out of the integrator's safe range, but a perfectly good quantity —
      // exactly what a backgrounded tab produces before anyone clamps it.
      expect(DeltaTimeSecs(30)).toBe(30)

      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
  })

  // The safety property the old refinement was reaching for, restated where it
  // is actually true: the CLAMP is the boundary, not the constructor.
  it('REGRESSION: clampDeltaTime is the boundary — its output is always inside the safe range', () => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -1000, max: 1000, noNaN: false }),
          (raw) => isClampedDelta(clampDeltaTime(raw)),
        ),
        { numRuns: 500 },
      )

      expect(isClampedDelta(DeltaTimeSecs(30))).toBe(false)
      expect(isClampedDelta(DeltaTimeSecs(0))).toBe(false)
      expect(isClampedDelta(MIN_DELTA_SECS)).toBe(true)
      expect(isClampedDelta(MAX_DELTA_SECS)).toBe(true)
      expect(isClampedDelta(FIRST_FRAME_DELTA_SECS)).toBe(true)
  })
})
