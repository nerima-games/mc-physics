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
import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { PositionAxis } from '@nerima-games/mc-kernel'
import { BlocksPerSecond, BlocksPerSecondSquared } from '../src/domain/physical-units'
import {
  CentreY,
  FootY,
  PLAYER_HALF_HEIGHT,
} from '../src/domain/coordinates'
import { DeltaTimeSecs, MAX_DELTA_SECS, MIN_DELTA_SECS } from '../src/domain/delta-time'
import {
  GRAVITY_Y,
  TERMINAL_VELOCITY_Y,
  integrate as integrateResult,
  integrateBody as integrateBodyResult,
  maxFallPerStep as maxFallPerStepResult,
  type Body,
  type IntegrationOptions,
} from '../src/domain/integrate'

type BodyOverrides = Omit<Partial<Body>, 'x' | 'z' | 'vx' | 'vy' | 'vz'> & {
  readonly x?: number
  readonly z?: number
  readonly vx?: number
  readonly vy?: number
  readonly vz?: number
}

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const integrateBody = (body: Body, delta: ReturnType<typeof DeltaTimeSecs>, options?: IntegrationOptions): Body =>
  unwrap(integrateBodyResult(body, delta, options))

const integrate = (bodies: ReadonlyArray<Body>, delta: ReturnType<typeof DeltaTimeSecs>, options?: IntegrationOptions) =>
  unwrap(integrateResult(bodies, delta, options))

const maxFallPerStep = (delta: ReturnType<typeof DeltaTimeSecs>) => unwrap(maxFallPerStepResult(delta))

const dynamicBody = (over: BodyOverrides = {}): Body => {
  const { kind = 'dynamic', x = 0, y = CentreY(100), z = 0, vx = 0, vy = 0, vz = 0 } = over
  return {
    kind,
    x: PositionAxis(x),
    y,
    z: PositionAxis(z),
    vx: BlocksPerSecond(vx),
    vy: BlocksPerSecond(vy),
    vz: BlocksPerSecond(vz),
  }
}

const footYMustNotBeAcceptedAsBodyCentre: Body = {
  kind: 'dynamic',
  x: PositionAxis(0),
  // A compile-time negative control for the convention this package is built
  // around: `Body` takes the AABB centre, so a `FootY` must not be assignable to
  // it. `@ts-expect-error` is what makes it a control rather than a comment. If
  // the two brands ever became interchangeable, this directive would become an
  // unused-directive error and `pnpm typecheck` would fail. Nothing reads the
  // value; the `void` below only satisfies `noUnusedLocals`.
  // @ts-expect-error Body coordinates use the AABB centre, never its feet.
  y: FootY(0),
  z: PositionAxis(0),
  vx: BlocksPerSecond(0),
  vy: BlocksPerSecond(0),
  vz: BlocksPerSecond(0),
}

void footYMustNotBeAcceptedAsBodyCentre

describe('semi-implicit Euler', () => {
  it('updates velocity first and position from the NEW velocity', () => {
      // Explicit Euler would give y = 100 exactly (old velocity 0). Symplectic
      // gives y = 100 + (g*dt)*dt. The difference is the whole distinction, and
      // it is what stops a bouncing entity from gaining energy every step.
      const delta = DeltaTimeSecs(MAX_DELTA_SECS)
      const stepped = integrateBody(dynamicBody(), delta)
      expect(stepped.vy).toBeCloseTo(GRAVITY_Y * delta, 12)
      expect(stepped.y).toBeCloseTo(100 + GRAVITY_Y * delta * delta, 12)
      expect(stepped.y).toBeLessThan(100)
  })

  it('never lets a dynamic body fall faster than terminal velocity', () => {
      fc.assert(
        fc.property(
          fc.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          fc.integer({ min: 1, max: 400 }),
          (rawDelta, steps) => {
            const delta = DeltaTimeSecs(rawDelta)
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
      expect(maxFallPerStep(DeltaTimeSecs(MAX_DELTA_SECS))).toBeLessThanOrEqual(bodyHeight)
  })

  it('leaves static and kinematic bodies completely alone', () => {
      const delta = DeltaTimeSecs(MAX_DELTA_SECS)
      for (const kind of ['static', 'kinematic'] as const) {
        const body = dynamicBody({ kind, vy: -5 })
        expect(integrateBody(body, delta)).toStrictEqual(body)
      }
  })

  it('is deterministic and order-independent across a world of bodies', () => {
      const delta = DeltaTimeSecs(MAX_DELTA_SECS)
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
      const stepped = integrateBody(dynamicBody({ vx: 3, vz: -4 }), DeltaTimeSecs(MAX_DELTA_SECS))
      expect(stepped.vx).toBe(3)
      expect(stepped.vz).toBe(-4)
  })
})

// ---------------------------------------------------------------------------
// FR-004: AIR DRAG
// ---------------------------------------------------------------------------

describe('air drag (FR-004)', () => {
  it('REGRESSION: the default dragPerSecond (1) reproduces the pre-injection integrator exactly', () => {
      const delta = DeltaTimeSecs(MAX_DELTA_SECS)
      const body = dynamicBody({ vx: 3, vy: -1, vz: -2 })
      expect(integrateBody(body, delta)).toStrictEqual(
        integrateBody(body, delta, { gravityY: GRAVITY_Y, dragPerSecond: 1, terminalVelocityY: TERMINAL_VELOCITY_Y }),
      )
  })

  it('PROPERTY: for dragPerSecond in (0, 1], no axis speed increases in one step', () => {
      // gravityY is pinned to 0 so the property isolates drag from the separate
      // vertical acceleration gravity contributes.
      fc.assert(
        fc.property(
          fc.double({ min: 1e-6, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          (dragPerSecond, vx, vy, vz, rawDelta) => {
            const delta = DeltaTimeSecs(rawDelta)
            const stepped = integrateBody(dynamicBody({ vx, vy, vz }), delta, { gravityY: BlocksPerSecondSquared(0), dragPerSecond })
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
      const delta = DeltaTimeSecs(MAX_DELTA_SECS)
      const dragPerSecond = 0.5
      const stepped = integrateBody(dynamicBody({ vx: 4, vy: 0, vz: -4 }), delta, { gravityY: BlocksPerSecondSquared(0), dragPerSecond })
      const expectedFactor = dragPerSecond ** delta
      expect(stepped.vx).toBeCloseTo(4 * expectedFactor, 12)
      expect(stepped.vz).toBeCloseTo(-4 * expectedFactor, 12)
  })

  it('returns a failure for invalid dragPerSecond values instead of substituting the no-drag default', () => {
      // A negative base raised to a non-integer exponent (a fractional
      // deltaTime, the normal case) is NaN in IEEE 754, and NaN multiplies
      // into every field of the body. >1 is rejected too: that is not "more
      // resistance", it is velocity growing every step — energy from nowhere.
      const delta = DeltaTimeSecs(MAX_DELTA_SECS)
      const body = dynamicBody({ vx: 3, vy: -1, vz: -2 })
      for (const invalid of [-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, 2]) {
        expect(Result.isFailure(integrateBodyResult(body, delta, { gravityY: GRAVITY_Y, dragPerSecond: invalid, terminalVelocityY: TERMINAL_VELOCITY_Y }))).toBe(true)
      }
      expect(Result.isFailure(integrateBodyResult(body, delta, {
        gravityY: GRAVITY_Y,
        // @ts-expect-error Exercise runtime rejection of explicit null.
        dragPerSecond: null,
      }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// FR-005: INJECTED TERMINAL VELOCITY
// ---------------------------------------------------------------------------

describe('injected terminal velocity (FR-005)', () => {
  it('caps at the injected value instead of the module default', () => {
      const shallow = BlocksPerSecond(TERMINAL_VELOCITY_Y / 2) // e.g. -16: a slower, shallower fall
      const delta = DeltaTimeSecs(MAX_DELTA_SECS)
      let body = dynamicBody()
      for (let step = 0; step < 400; step += 1) {
        body = integrateBody(body, delta, { gravityY: GRAVITY_Y, dragPerSecond: 1, terminalVelocityY: BlocksPerSecond(shallow) })
      }
      expect(body.vy).toBe(shallow)
  })

  it('returns a failure for non-negative or non-finite terminalVelocityY values instead of substituting the default', () => {
      const delta = DeltaTimeSecs(MAX_DELTA_SECS)
      for (const invalid of [0, 5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(Result.isFailure(integrateBodyResult(dynamicBody(), delta, {
          gravityY: GRAVITY_Y,
          dragPerSecond: 1,
          // @ts-expect-error Exercise runtime rejection of malformed branded values.
          terminalVelocityY: invalid,
        }))).toBe(true)
      }
      expect(Result.isFailure(integrateBodyResult(dynamicBody(), delta, {
        // @ts-expect-error Exercise runtime rejection of explicit null.
        terminalVelocityY: null,
      }))).toBe(true)
  })

  it('returns failures when computed integration scalars cannot be branded', () => {
    const delta = DeltaTimeSecs(MAX_DELTA_SECS)
    const overflowingBody = dynamicBody({ x: Number.MAX_VALUE, vx: Number.MAX_VALUE })

    expect(Result.isFailure(integrateBodyResult(overflowingBody, delta))).toBe(true)
    expect(Result.isFailure(integrateResult([dynamicBody(), overflowingBody], delta))).toBe(true)
    expect(Result.isFailure(maxFallPerStepResult(DeltaTimeSecs(Number.MAX_VALUE)))).toBe(true)
  })

  it('returns failures for invalid integration inputs and gravity', () => {
    const delta = DeltaTimeSecs(MAX_DELTA_SECS)
    const invalidBody: Body = {
      ...dynamicBody(),
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      x: Number.NaN,
    }

    expect(Result.isFailure(integrateBodyResult(invalidBody, delta))).toBe(true)
    expect(Result.isFailure(integrateBodyResult(dynamicBody(), delta, {
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      gravityY: Number.NaN,
    }))).toBe(true)
    expect(Result.isFailure(integrateBodyResult(dynamicBody(), delta, {
      // @ts-expect-error Exercise runtime rejection of explicit null.
      gravityY: null,
    }))).toBe(true)
    // @ts-expect-error Exercise runtime rejection of a malformed branded value.
    expect(Result.isFailure(maxFallPerStepResult(Number.NaN))).toBe(true)
  })

})
