/**
 * Semi-implicit Euler integration.
 *
 * Integration is composed with AABB collision resolution by `stepBody`.
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
import { BlockLength, BlocksPerSecond, BlocksPerSecondSquared } from './physical-units.js'
import { type Brand, Result } from 'effect'
import { DeltaTimeSecs, PositionAxis } from '@nerima-games/mc-kernel'
import { CentreY } from './coordinates.js'

/** Reference gravity (`packages/game/application/game-state-support.ts:10`). */
const GRAVITY_Y_VALUE = -9.82
export const GRAVITY_Y: BlocksPerSecondSquared = BlocksPerSecondSquared(GRAVITY_Y_VALUE)

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
const TERMINAL_VELOCITY_Y_VALUE = -32
export const TERMINAL_VELOCITY_Y: BlocksPerSecond = BlocksPerSecond(TERMINAL_VELOCITY_Y_VALUE)

export type BodyKind = 'dynamic' | 'static' | 'kinematic'

export type Body = {
  readonly kind: BodyKind
  readonly x: PositionAxis
  /** CENTRE Y. See domain/coordinates.ts on why the distinction is typed. */
  readonly y: CentreY
  readonly z: PositionAxis
  readonly vx: BlocksPerSecond
  readonly vy: BlocksPerSecond
  readonly vz: BlocksPerSecond
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
 *
 * `dragPerSecond` (default 1, no drag) is the continuous counterpart of a
 * per-tick multiplier: `v *= dragPerSecond ** dt`, applied to all three axes
 * before gravity. Vanilla's per-tick ~0.98-0.99 at 20 ticks/s is
 * `0.98 ** 20 ≈ 0.667/s`.
 *
 * `terminalVelocityY` (default `TERMINAL_VELOCITY_Y`) overrides the downward
 * speed cap. Only a finite, negative value is a meaningful cap on falling;
 * anything else falls back to the module default.
 */
/** Only a finite, negative value is a valid downward-speed cap; anything else falls back to the default. */
const normalizeTerminalVelocityY = (value: BlocksPerSecond): BlocksPerSecond => {
  if (Number.isFinite(value) && value < 0) {
    return value
  }
  return TERMINAL_VELOCITY_Y
}

/**
 * Only a finite value in [0, 1] is a meaningful per-second drag multiplier.
 * A negative base raised to a non-integer exponent (deltaTime is a fractional
 * seconds value) is NaN in IEEE 754, and NaN then multiplies into every field
 * of the body — position included — via `draggedVx/Vy/Vz`. Above 1 is
 * rejected too: that is not "more resistance", it is velocity growing every
 * step, i.e. energy injected from nowhere. Anything invalid falls back to 1
 * (no drag).
 */
const normalizeDragPerSecond = (value: number): number => {
  if (Number.isFinite(value) && value >= 0 && value <= 1) {
    return value
  }
  return 1
}

export type IntegrationOptions = Readonly<{
  gravityY?: BlocksPerSecondSquared
  dragPerSecond?: number
  terminalVelocityY?: BlocksPerSecond
}>

export const integrateBody = (
  body: Body,
  deltaTime: DeltaTimeSecs,
  options: IntegrationOptions = {},
): Result.Result<Body, Brand.BrandError> => {
  const xSnapshot = body.x
  const ySnapshot = body.y
  const zSnapshot = body.z
  const vxSnapshot = body.vx
  const vySnapshot = body.vy
  const vzSnapshot = body.vz
  const deltaSnapshot = deltaTime
  const checkedInputs = Result.all([
    PositionAxis.result(xSnapshot),
    CentreY.result(ySnapshot),
    PositionAxis.result(zSnapshot),
    BlocksPerSecond.result(vxSnapshot),
    BlocksPerSecond.result(vySnapshot),
    BlocksPerSecond.result(vzSnapshot),
    DeltaTimeSecs.result(deltaSnapshot),
  ])
  if (Result.isFailure(checkedInputs)) {
    return Result.fail(checkedInputs.failure)
  }

  const [x, y, z, vx, vy, vz, validDeltaTime] = checkedInputs.success
  if (body.kind !== 'dynamic') {
    return Result.succeed(body)
  }

  const gravitySnapshot = options.gravityY ?? GRAVITY_Y
  const checkedGravity = BlocksPerSecondSquared.result(gravitySnapshot)
  if (Result.isFailure(checkedGravity)) {
    return Result.fail(checkedGravity.failure)
  }
  const drag = normalizeDragPerSecond(options.dragPerSecond ?? 1) ** validDeltaTime
  const draggedVx = vx * drag
  const draggedVy = vy * drag
  const draggedVz = vz * drag

  // Velocity first, position from the NEW velocity. See the file header.
  const acceleratedY = draggedVy + checkedGravity.success * validDeltaTime
  const terminalSnapshot = options.terminalVelocityY ?? TERMINAL_VELOCITY_Y
  const checkedTerminal = BlocksPerSecond.result(normalizeTerminalVelocityY(terminalSnapshot))
  return Result.flatMap(checkedTerminal, (safeTerminalVelocityY) => {
    let clampedY = acceleratedY
    if (acceleratedY < safeTerminalVelocityY) {
      clampedY = safeTerminalVelocityY
    }

    return Result.map(
      Result.all([
        BlocksPerSecond.result(draggedVx),
        BlocksPerSecond.result(clampedY),
        BlocksPerSecond.result(draggedVz),
        PositionAxis.result(x + draggedVx * validDeltaTime),
        CentreY.result(y + clampedY * validDeltaTime),
        PositionAxis.result(z + draggedVz * validDeltaTime),
      ]),
      ([nextVx, nextVy, nextVz, nextX, nextY, nextZ]): Body => ({
        kind: body.kind,
        vx: nextVx,
        vy: nextVy,
        vz: nextVz,
        x: nextX,
        y: nextY,
        z: nextZ,
      }),
    )
  })
}

/** Advance a whole world by one step. Order-independent: bodies do not interact here. */
export const integrate = (
  bodies: ReadonlyArray<Body>,
  deltaTime: DeltaTimeSecs,
  options: IntegrationOptions = {},
): Result.Result<ReadonlyArray<Body>, Brand.BrandError> =>
  Result.all(bodies.map((body) => integrateBody(body, deltaTime, options)))

/**
 * The largest distance a body can fall in one step.
 *
 * Exposed so the tunnelling invariant can be asserted as an inequality between
 * named constants instead of as a magic number in a test.
 */
export const maxFallPerStep = (maxDeltaSecs: DeltaTimeSecs): Result.Result<BlockLength, Brand.BrandError> => {
  const deltaSnapshot = maxDeltaSecs
  const checkedDelta = DeltaTimeSecs.result(deltaSnapshot)
  if (Result.isFailure(checkedDelta)) {
    return Result.fail(checkedDelta.failure)
  }
  return BlockLength.result(Math.abs(TERMINAL_VELOCITY_Y) * checkedDelta.success)
}
