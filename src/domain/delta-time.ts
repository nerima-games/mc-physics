/**
 * Frame timing at the boundary between clock readings and fixed steps.
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
 * WHY DELTA VALIDATION LIVES AT THE CLOCK BOUNDARY
 * ---------------------------------------------------------------------------
 *
 * `DeltaTimeSecs` belongs to `@nerima-games/mc-kernel`, which refines it to
 * "finite and non-negative". A ZERO delta is legal, because a frame may be
 * scheduled twice inside one clock tick. This module imports and re-exports
 * that type and constructor directly.
 *
 * It used to refine to `[0.001, 0.05]` instead, and that was a defect rather
 * than a stricter-is-safer choice. `Brand.Brand<'DeltaTimeSecs'>` is keyed by
 * the STRING `'DeltaTimeSecs'`, so two declarations with different
 * refinements would still be the SAME TYPE to TypeScript. A `DeltaTimeSecs(30)`
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
 * quantity itself. The frame boundary validates the monotonic readings once,
 * then passes them to kernel's `frameDeltaBetween` implementation.
 */
import { type Brand, Result } from 'effect'
import {
  DeltaTimeSecs,
  FIRST_FRAME_DELTA_SECS,
  MAX_FRAME_DELTA_SECS,
  MIN_FRAME_DELTA_SECS,
  MonotonicTimeSecs,
  frameDeltaBetween,
} from '@nerima-games/mc-kernel'

export { DeltaTimeSecs, MonotonicTimeSecs } from '@nerima-games/mc-kernel'

/**
 * Elapsed simulation time for one frame, in seconds. Finite and non-negative.
 *
 * Kernel's refinement, verbatim. `deltaTimeBetween` bounds elapsed time before
 * handing one fixed step to the integrator.
 */
export {
  MAX_FRAME_DELTA_SECS as MAX_DELTA_SECS,
  MIN_FRAME_DELTA_SECS as MIN_DELTA_SECS,
} from '@nerima-games/mc-kernel'

/** One 60 Hz frame. Used when there is no previous timestamp to subtract. */
export { FIRST_FRAME_DELTA_SECS } from '@nerima-games/mc-kernel'
export { clampFrameDelta } from '@nerima-games/mc-kernel'

/** The brand's own floor — any non-negative delta is legal, even outside the clamp range below (see the module header). */
/**
 * Is this delta inside the integrator's safe step range?
 *
 * The predicate the brand deliberately no longer enforces, exposed so that the
 * invariant is still checkable where it matters — in the integrator's tests,
 * and in any future assertion at the frame-loop boundary. `deltaTimeBetween`
 * returns a value for which this is true, always.
 */
export const isClampedDelta = (deltaSecs: DeltaTimeSecs): boolean =>
  Number.isFinite(deltaSecs) && deltaSecs >= MIN_FRAME_DELTA_SECS && deltaSecs <= MAX_FRAME_DELTA_SECS

/**
 * The delta for a frame, given the previous and current monotonic readings in
 * seconds. `previousSecs === undefined` means "first frame".
 *
 * Takes readings rather than reading a clock. Production simulation code does
 * not access a clock, so a replay produces the same simulation; the benchmark
 * harness is the only code that measures elapsed wall time.
 */
export const deltaTimeBetween = (
  previousSecs: number | undefined,
  currentSecs: number,
): Result.Result<DeltaTimeSecs, Brand.BrandError> => {
  const currentSnapshot = currentSecs
  const currentTime = MonotonicTimeSecs.result(currentSnapshot)
  if (Result.isFailure(currentTime)) {
    return Result.fail(currentTime.failure)
  }

  if (typeof previousSecs === 'undefined') {
    return Result.succeed(FIRST_FRAME_DELTA_SECS)
  }

  const previousSnapshot = previousSecs
  const previousTime = MonotonicTimeSecs.result(previousSnapshot)
  if (Result.isFailure(previousTime)) {
    return Result.fail(previousTime.failure)
  }

  return Result.succeed(frameDeltaBetween(previousTime.success, currentTime.success))
}
