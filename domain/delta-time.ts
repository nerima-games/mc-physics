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
 */
import { Brand } from 'effect'

/** A frame duration in seconds. Always in [MIN_DELTA_SECS, MAX_DELTA_SECS]. */
export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>

export const MIN_DELTA_SECS = 0.001
export const MAX_DELTA_SECS = 0.05

/** One 60 Hz frame. Used when there is no previous timestamp to subtract. */
export const FIRST_FRAME_DELTA_SECS = 0.016

/**
 * Refined rather than nominal: an unclamped delta must not be constructible.
 * The clamp is the only supported way in, and this refinement is what makes
 * that true rather than merely conventional.
 */
export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= MIN_DELTA_SECS && value <= MAX_DELTA_SECS,
  (value) =>
    Brand.error(
      `DeltaTimeSecs must be in [${MIN_DELTA_SECS}, ${MAX_DELTA_SECS}], received ${value}. ` +
        'Use clampDeltaTime rather than constructing one directly.',
    ),
)

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
