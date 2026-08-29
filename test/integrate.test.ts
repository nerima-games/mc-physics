/**
 * Euler integration (semi-implicit), air drag, and injected terminal
 * velocity — the frame-by-frame physics step, exercised in isolation from
 * collision resolution.
 *
 * The deltaTime clamp has its own suite in test/delta-time.test.ts, and the
 * voxel DDA has its own suite in test/dda.test.ts (FR-016) — this file's
 * concern is pure integration.
 *
 * Regression names (docs/design-notes.md):
 *   physics-integrator-is-symplectic
 *   physics-terminal-velocity-cannot-tunnel
 */
import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import {
  CentreY,
  FootY,
  PLAYER_HALF_HEIGHT,
} from '../src/domain/coordinates'
import { MAX_DELTA_SECS, MIN_DELTA_SECS, clampDeltaTime } from '../src/domain/delta-time'
import { GRAVITY_Y, TERMINAL_VELOCITY_Y, integrate, integrateBody, maxFallPerStep, type Body } from '../src/domain/integrate'

const dynamicBody = (over: Partial<Body> = {}): Body => ({
  kind: 'dynamic',
  x: 0,
  y: CentreY(100),
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  ...over,
})

const footYMustNotBeAcceptedAsBodyCentre: Body = {
  kind: 'dynamic',
  x: 0,
  // @ts-expect-error Body coordinates use the AABB centre, never its feet.
  y: FootY(0),
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
}

void footYMustNotBeAcceptedAsBodyCentre

describe('semi-implicit Euler', () => {
  it('updates velocity first and position from the NEW velocity', () => {
      // Explicit Euler would give y = 100 exactly (old velocity 0). Symplectic
      // gives y = 100 + (g*dt)*dt. The difference is the whole distinction, and
      // it is what stops a bouncing entity from gaining energy every step.
      const delta = clampDeltaTime(0.02)
      const stepped = integrateBody(dynamicBody(), delta)
      expect(stepped.vy).toBeCloseTo(GRAVITY_Y * delta, 12)
      expect(stepped.y).toBeCloseTo(100 + GRAVITY_Y * delta * delta, 12)
      expect(stepped.y).toBeLessThan(100)
  })

  it('never lets a dynamic body fall faster than terminal velocity', () => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          FastCheck.integer({ min: 1, max: 400 }),
          (rawDelta, steps) => {
            const delta = clampDeltaTime(rawDelta)
            let body = dynamicBody()
            for (let step = 0; step < steps; step += 1) {
              body = integrateBody(body, delta)
              if (body.vy < TERMINAL_VELOCITY_Y) {
                return false
              }
            }
            return true
          },
        ),
        { numRuns: 100 },
      )
  })

  it('TUNNELLING INVARIANT: one step at the delta cap never falls further than one body height', () => {
      // The AABB resolver can only catch a floor that ends up inside the body's
      // box. If this inequality ever breaks, fast falls pass through floors and
      // no test of the resolver itself would notice. Asserted between named
      // constants so that tuning either one fails here.
      const bodyHeight = 2 * Number(PLAYER_HALF_HEIGHT)
      expect(maxFallPerStep(MAX_DELTA_SECS)).toBeLessThanOrEqual(bodyHeight)
  })

  it('leaves static and kinematic bodies completely alone', () => {
      const delta = clampDeltaTime(0.02)
      for (const kind of ['static', 'kinematic'] as const) {
        const body = dynamicBody({ kind, vy: -5 })
        expect(integrateBody(body, delta)).toStrictEqual(body)
      }
  })

  it('is deterministic and order-independent across a world of bodies', () => {
      const delta = clampDeltaTime(0.02)
      const bodies: ReadonlyArray<Body> = [
        dynamicBody({ y: CentreY(10) }),
        dynamicBody({ kind: 'static', y: CentreY(20) }),
        dynamicBody({ y: CentreY(30), vx: 1 }),
      ]
      expect(integrate(bodies, delta)).toStrictEqual(integrate(bodies, delta))
      const reversed = integrate([...bodies].reverse(), delta)
      expect([...reversed].reverse()).toStrictEqual(integrate(bodies, delta))

      // The two lines above probe with `reverse()` and compare a reversed
      // answer, so a `reverse()` INSIDE `integrate` cancels itself out and they
      // stay green — the single permutation they cannot see is the one they use
      // to look. The positional claim is asked directly instead: entry `index`
      // is the integration of the body at `index`, which is what makes
      // `integrate` a map rather than merely a bag of the right bodies, and it
      // is what a caller writing the answers back onto its own list relies on.
      // `resolve.test.ts` states the same property for `resolveWorld`.
      const together = integrate(bodies, delta)
      bodies.forEach((body, index) => {
        expect(together[index]).toStrictEqual(integrateBody(body, delta))
      })
  })

  it('does not touch horizontal velocity: gravity acts on Y only', () => {
      const stepped = integrateBody(dynamicBody({ vx: 3, vz: -4 }), clampDeltaTime(0.02))
      expect(stepped.vx).toBe(3)
      expect(stepped.vz).toBe(-4)
  })
})

// ---------------------------------------------------------------------------
// FR-004: AIR DRAG
// ---------------------------------------------------------------------------

describe('air drag (FR-004)', () => {
  it('REGRESSION: the default dragPerSecond (1) reproduces the pre-injection integrator exactly', () => {
      const delta = clampDeltaTime(0.02)
      const body = dynamicBody({ vx: 3, vy: -1, vz: -2 })
      expect(integrateBody(body, delta)).toStrictEqual(
        integrateBody(body, delta, GRAVITY_Y, 1, TERMINAL_VELOCITY_Y),
      )
  })

  it('PROPERTY: for dragPerSecond in (0, 1], no axis speed increases in one step', () => {
      // gravityY is pinned to 0 so the property isolates drag from the separate
      // vertical acceleration gravity contributes.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: 1e-6, max: 1, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          (dragPerSecond, vx, vy, vz, rawDelta) => {
            const delta = clampDeltaTime(rawDelta)
            const stepped = integrateBody(dynamicBody({ vx, vy, vz }), delta, 0, dragPerSecond)
            return (
              Math.abs(stepped.vx) <= Math.abs(vx) + 1e-9 &&
              Math.abs(stepped.vy) <= Math.abs(vy) + 1e-9 &&
              Math.abs(stepped.vz) <= Math.abs(vz) + 1e-9
            )
          },
        ),
        { numRuns: 300 },
      )
  })

  it('applies the continuous form: v *= dragPerSecond ** dt, on all three axes', () => {
      // Vanilla per-tick drag of ~0.98 at 20 ticks/s is dragPerSecond = 0.98 **
      // 20 ≈ 0.667/s; this checks the continuous formula the other direction,
      // at an arbitrary dt rather than the tick boundary.
      const delta = clampDeltaTime(0.1)
      const dragPerSecond = 0.5
      const stepped = integrateBody(dynamicBody({ vx: 4, vy: 0, vz: -4 }), delta, 0, dragPerSecond)
      const expectedFactor = dragPerSecond ** delta
      expect(stepped.vx).toBeCloseTo(4 * expectedFactor, 12)
      expect(stepped.vz).toBeCloseTo(-4 * expectedFactor, 12)
  })
})

// ---------------------------------------------------------------------------
// FR-005: INJECTED TERMINAL VELOCITY
// ---------------------------------------------------------------------------

describe('injected terminal velocity (FR-005)', () => {
  it('caps at the injected value instead of the module default', () => {
      const shallow = TERMINAL_VELOCITY_Y / 2 // e.g. -16: a slower, shallower fall
      const delta = clampDeltaTime(0.02)
      let body = dynamicBody()
      for (let step = 0; step < 400; step += 1) {
        body = integrateBody(body, delta, GRAVITY_Y, 1, shallow)
      }
      expect(body.vy).toBe(shallow)
  })

  it('REGRESSION: a non-negative or non-finite terminalVelocityY falls back to the module default', () => {
      const delta = clampDeltaTime(0.05)
      const fallToTerminal = (invalid: number): number => {
        let body = dynamicBody()
        // |TERMINAL_VELOCITY_Y| / |GRAVITY_Y| ≈ 3.26s to reach the asymptote;
        // 200 steps at this delta is ~10s, comfortably past it.
        for (let step = 0; step < 200; step += 1) {
          body = integrateBody(body, delta, GRAVITY_Y, 1, invalid)
        }
        return body.vy
      }
      for (const invalid of [0, 5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(fallToTerminal(invalid)).toBe(TERMINAL_VELOCITY_Y)
      }
  })
})
