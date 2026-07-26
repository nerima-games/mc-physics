/**
 * The frame delta, clamped.
 *
 * FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * The exact expression, and why each half of it is load-bearing
 * ---------------------------------------------------------------------------
 *
 * The reference clamps with, verbatim
 * (`packages/game/application/game-loop.ts:119`):
 *
 *   const deltaTime = DeltaTimeSecs.make(Math.min(Math.max(0.001, rawDelta), 0.05))
 *
 * UPPER BOUND 0.05 s. A tab that was backgrounded for thirty seconds delivers a
 * thirty-second delta. Integrating that in one step teleports every entity
 * through the floor and out of the world. 0.05 s is not arbitrary: it is tied
 * to the terminal velocity, and the reference has a test asserting the
 * relationship (`packages/game/test/physics-world-service.test.ts:115-122`) —
 * |TERMINAL_VELOCITY_Y| * 0.05 <= 2 * PLAYER_HALF_HEIGHT, i.e. a body may never
 * fall further than its own height in one step, because the AABB resolver only
 * sees floors that end up inside the body's box. Change one number and the
 * tunnelling guard silently stops guarding. That test is reproduced here.
 *
 * LOWER BOUND 0.001 s. A zero or negative delta arrives from a clock that went
 * backwards (NTP correction, a monotonic source that is not) and from a
 * duplicated frame callback. Zero makes velocity integration a no-op and makes
 * any rate computed as `x / dt` infinite.
 *
 * FIRST FRAME 0.016 s. There is no previous timestamp to subtract, so the
 * reference substitutes one 60 Hz frame
 * (`packages/core/domain/constants.ts:8-9`, `FIRST_FRAME_DELTA_SECS`).
 *
 * See docs/design-notes.md, regressions `physics-delta-clamp-is-exact` and
 * `physics-terminal-velocity-cannot-tunnel`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BRAND IS LOOSE AND THE CLAMP IS A FUNCTION
 * ---------------------------------------------------------------------------
 *
 * `DeltaTimeSecs` belongs to `@nerima-games/mc-kernel`
 * (`mc-kernel/domain/quantities.ts:37-42`), which refines it to "finite and
 * non-negative" and says so explicitly: a ZERO delta is legal, because a frame
 * may be scheduled twice inside one clock tick. This declaration mirrors that
 * refinement exactly, error message included.
 *
 * It used to refine to `[0.001, 0.05]` instead, and that was a defect rather
 * than a stricter-is-safer choice. `Brand.Brand<'DeltaTimeSecs'>` is keyed by
 * the STRING `'DeltaTimeSecs'`, so kernel's brand and this one are the SAME
 * TYPE to TypeScript however differently they validate. A `DeltaTimeSecs(30)`
 * constructed through kernel — legal there — therefore satisfied
 * `integrateBody`'s parameter type while violating the invariant its comment
 * claimed, and no compiler nor constructor would say a word. Two nominally
 * identical brands with different invariants is the same failure mode as two
 * `Context.Tag`s sharing a key (see `mc-sim/domain/kernel-vocabulary.ts`): the
 * type system cannot distinguish them, so the stricter one buys nothing and
 * costs a false guarantee.
 *
 * The clamp is not thereby weakened; it is moved to where it belongs. It is a
 * FRAME-LOOP concern — "what happens after a tab was backgrounded for thirty
 * seconds" is a question about the loop that produced the delta, not about the
 * quantity itself — and it is applied at the boundary by `clampDeltaTime`,
 * which remains the only sanctioned way to turn a raw interval into a delta fit
 * for integration. mc-sim does exactly this with kernel's brand already
 * (`mc-sim/domain/frame-timing.ts`). `isClampedDelta` below makes the invariant
 * assertable at the points that actually depend on it.
 */
import { Brand } from 'effect'

/**
 * Elapsed simulation time for one frame, in seconds. Finite and non-negative.
 *
 * Kernel's refinement, verbatim. NOT clamped — see the module header, and use
 * `clampDeltaTime` before handing one to the integrator.
 */
export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>

export const MIN_DELTA_SECS = 0.001
export const MAX_DELTA_SECS = 0.05

/** One 60 Hz frame. Used when there is no previous timestamp to subtract. */
export const FIRST_FRAME_DELTA_SECS = 0.016

export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`DeltaTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * Is this delta inside the integrator's safe step range?
 *
 * The predicate the brand deliberately no longer enforces, exposed so that the
 * invariant is still checkable where it matters — in the integrator's tests,
 * and in any future assertion at the frame-loop boundary. `clampDeltaTime`
 * returns a value for which this is true, always.
 */
export const isClampedDelta = (deltaSecs: number): boolean =>
  Number.isFinite(deltaSecs) && deltaSecs >= MIN_DELTA_SECS && deltaSecs <= MAX_DELTA_SECS

/**
 * The clamp. Byte-for-byte the reference's expression, deliberately.
 *
 * NaN maps to the first-frame delta rather than propagating: `Math.max(a, NaN)`
 * is NaN, and a NaN delta poisons every position in the world within one frame
 * while leaving no evidence of where it came from.
 */
export const clampDeltaTime = (rawDeltaSecs: number): DeltaTimeSecs => {
  if (Number.isNaN(rawDeltaSecs)) {
    return DeltaTimeSecs(FIRST_FRAME_DELTA_SECS)
  }
  return DeltaTimeSecs(Math.min(Math.max(MIN_DELTA_SECS, rawDeltaSecs), MAX_DELTA_SECS))
}

/**
 * The delta for a frame, given the previous and current monotonic readings in
 * seconds. `previousSecs === undefined` means "first frame".
 *
 * Takes readings rather than reading a clock: `Date.now()` and
 * `performance.now()` are banned repository-wide and `pnpm check:deps` enforces
 * it. Time is injected, so a replay produces the same simulation.
 */
export const deltaTimeBetween = (previousSecs: number | undefined, currentSecs: number): DeltaTimeSecs =>
  previousSecs === undefined
    ? DeltaTimeSecs(FIRST_FRAME_DELTA_SECS)
    : clampDeltaTime(currentSecs - previousSecs)
