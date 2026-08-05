/**
 * Semi-implicit Euler integration.
 *
 * FIRST CUT (叩き台). Integration is complete; the AABB collision resolver that
 * must run after it is the next piece of work — see README 現状.
 *
 * ---------------------------------------------------------------------------
 * The order matters, twice over
 * ---------------------------------------------------------------------------
 *
 * WITHIN a step: velocity is updated from acceleration FIRST, then position
 * from the NEW velocity. That is semi-implicit (symplectic) Euler, and it is
 * what the reference does
 * (`packages/game/infrastructure/boundary/physics-world-service.ts:39-54`).
 * Explicit Euler — position from the OLD velocity — injects energy on every
 * step, so a bouncing entity climbs. Swapping the two lines looks like a
 * cosmetic reorder and is not.
 *
 * ACROSS a frame: integrate, THEN resolve collisions. plan.md §3.4 records this
 * as an implementation note about ground clamping, and it is worth being exact
 * about what it means. In the reference the ground clamp is not a separate
 * pass; it is three lines INSIDE the AABB resolver
 * (`packages/game/domain/aabb-collision.ts:281-285`):
 *
 *     if (maxFloorY > Number.NEGATIVE_INFINITY) {
 *       y = maxFloorY + halfH
 *       vy = 0
 *       isGrounded = true
 *     }
 *
 * and the resolver is called after `step()`, via
 * `game-state-update-orchestration.ts:175` (step) -> `:187` -> `player-motion.ts:94`
 * -> `player-physics.ts:293` -> `:158` (resolve). Integrate first, then clamp.
 * Reverse them and gravity is applied after the clamp, so everything hovers one
 * frame's fall above the floor, permanently. That is the "things float" bug in
 * its other guise.
 *
 * See docs/design-notes.md, regressions `physics-integrator-is-symplectic` and
 * `physics-resolve-runs-after-integrate`.
 */
import { CentreY } from './coordinates'
import type { DeltaTimeSecs } from './delta-time'

/** Reference gravity (`packages/game/application/game-state-support.ts:10`). */
export const GRAVITY_Y = -9.82

/**
 * Downward speed cap, m/s.
 *
 * NOT a physical claim about air resistance. It is the tunnelling guard: the
 * AABB resolver can only catch a floor that lands inside the body's box after a
 * step, so the fall in one step must not exceed the body's height. With
 * MAX_DELTA_SECS = 0.05 and a 1.8 m body, the largest safe speed is
 * 1.8 / 0.05 = 36; the reference picks 32 for margin
 * (`physics-world-service.ts:6-16`). `test/integrate.test.ts` asserts the
 * inequality rather than the constant, so tuning one number cannot silently
 * break the other.
 */
export const TERMINAL_VELOCITY_Y = -32

export type BodyKind = 'dynamic' | 'static' | 'kinematic'

export type Body = {
  readonly kind: BodyKind
  readonly x: number
  /** CENTRE Y. See domain/coordinates.ts on why the distinction is typed. */
  readonly y: CentreY
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
}

/**
 * Advance one body by one step.
 *
 * Pure: returns a new body rather than mutating. The reference mutates in place
 * for allocation reasons, and this repository will need an in-place variant on
 * the hot path too — but only once there is a benchmark, and behind an API
 * whose pure version is the reference definition. Correctness first; the
 * mutable version will be tested against this one.
 *
 * `static` and `kinematic` bodies are returned unchanged: gravity does not act
 * on them and their motion is authored elsewhere.
 */
export const integrateBody = (body: Body, deltaTime: DeltaTimeSecs, gravityY: number = GRAVITY_Y): Body => {
  if (body.kind !== 'dynamic') {
    return body
  }

  // Velocity first, position from the NEW velocity. See the file header.
  const acceleratedY = body.vy + gravityY * deltaTime
  const clampedY = acceleratedY < TERMINAL_VELOCITY_Y ? TERMINAL_VELOCITY_Y : acceleratedY

  return {
    kind: body.kind,
    vx: body.vx,
    vy: clampedY,
    vz: body.vz,
    x: body.x + body.vx * deltaTime,
    y: CentreY(body.y + clampedY * deltaTime),
    z: body.z + body.vz * deltaTime,
  }
}

/** Advance a whole world by one step. Order-independent: bodies do not interact here. */
export const integrate = (
  bodies: ReadonlyArray<Body>,
  deltaTime: DeltaTimeSecs,
  gravityY: number = GRAVITY_Y,
): ReadonlyArray<Body> => bodies.map((body) => integrateBody(body, deltaTime, gravityY))

/**
 * The largest distance a body can fall in one step.
 *
 * Exposed so the tunnelling invariant can be asserted as an inequality between
 * named constants instead of as a magic number in a test.
 */
export const maxFallPerStep = (maxDeltaSecs: number): number => Math.abs(TERMINAL_VELOCITY_Y) * maxDeltaSecs
