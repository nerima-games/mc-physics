/**
 * FR-010: one glide-tick of velocity change, elytra-shaped.
 *
 * `glideStep` answers only "what does gliding do to velocity this frame".
 * Whether an entity IS gliding — elytra equipped, durability, not grounded —
 * is the caller's responsibility, the same split `applyMovementInput`
 * (`domain/movement.ts`) draws against its caller's grounded check.
 *
 * ---------------------------------------------------------------------------
 * Sourcing, and being honest about what is and is not verified
 * ---------------------------------------------------------------------------
 *
 * Java's actual `LivingEntity.travel()` elytra branch is not available here
 * as checked Mojang source. The per-tick shape below is drawn from community
 * reverse-engineering (a 15w41b-era decompile transcribed at
 * https://gist.github.com/samsartor/a7ec457aca23a7f3f120) and the Minecraft
 * Wiki's qualitative description of elytra flight — not a byte-for-byte port,
 * and not claimed to match Java's output value-for-value. What IS reproduced
 * deliberately is the documented SHAPE: diving trades altitude for speed,
 * level flight glides down slowly, climbing trades speed for altitude,
 * gravity is heavily (not fully) cancelled while gliding, and horizontal
 * velocity turns toward the look direction over time rather than snapping to
 * it. The constants below are this repository's own calibration toward that
 * shape, converted to a seconds basis at TICK_SECONDS = 0.05 (delta-time.ts's
 * assumed frame rate), the same conversion `applyFluidMotion`
 * (`domain/fluid.ts`) already performs for its drag coefficients.
 */
import type { DeltaTimeSecs, Position } from '@nerima-games/mc-kernel'

/** Look direction as pitch/yaw — same fields as `ArrowLaunch` (`domain/projectile.ts`) and `MovementInput.yawRadians`. */
export type GlideSight = Readonly<{
  readonly pitchRadians: number
  readonly yawRadians: number
}>

export type GlideConfig = Readonly<{
  readonly gravityPerSecondSquared: number
  readonly liftCancelFactor: number
  readonly diveConversionPerSecond: number
  readonly climbConversionPerSecond: number
  readonly climbLiftMultiplier: number
  readonly turnRatePerSecond: number
  readonly horizontalDragPerSecond: number
  readonly verticalDragPerSecond: number
}>

const finiteOrZero = (value: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return 0
}

const nonNegativeFinite = (value: number): number => Math.max(0, finiteOrZero(value))

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** One 20 Hz tick, matching `delta-time.ts`'s assumed frame rate. */
const TICK_SECONDS = 0.05

/** A per-tick multiplicative decay `perTick = exp(-rate * TICK_SECONDS)`, solved for the continuous per-second rate. */
const decayRatePerSecond = (perTick: number): number => -Math.log(perTick) / TICK_SECONDS

/** Per-tick keep-factors from the community-reversed decompile (see the module header). */
const TURN_KEEP_PER_TICK = 0.9
const HORIZONTAL_DRAG_KEEP_PER_TICK = 0.99
const VERTICAL_DRAG_KEEP_PER_TICK = 0.98

/** -0.08/tick (community-reversed elytra gravity — see module header) converted to a per-second rate. */
export const GLIDE_GRAVITY_PER_SECOND_SQUARED = -1.6
/** Fraction of gravity cancelled at pitch 0 (level flight); the rest is the residual glide-down rate. */
export const GLIDE_LIFT_CANCEL_FACTOR = 0.9
/** Flat, dt-scaled forward-speed gain from a downward look. Independent of current speed, so it cannot compound step over step — see the "cannot compound" property test. */
export const GLIDE_DIVE_CONVERSION_PER_SECOND = 0.8
/** Horizontal-speed-to-lift conversion rate while climbing, on the same 0.04/tick order as the dive conversion. */
export const GLIDE_CLIMB_CONVERSION_PER_SECOND = 0.8
/** Unitless: how much of the horizontal speed spent climbing becomes vertical speed. */
export const GLIDE_CLIMB_LIFT_MULTIPLIER = 3.5
/** A 10%-per-tick turn-toward-look-direction blend, continuised. */
export const GLIDE_TURN_RATE_PER_SECOND = decayRatePerSecond(TURN_KEEP_PER_TICK)
/** Community-reversed per-tick horizontal air drag, continuised. */
export const GLIDE_HORIZONTAL_DRAG_PER_SECOND = decayRatePerSecond(HORIZONTAL_DRAG_KEEP_PER_TICK)
/** Community-reversed per-tick vertical air drag, continuised. */
export const GLIDE_VERTICAL_DRAG_PER_SECOND = decayRatePerSecond(VERTICAL_DRAG_KEEP_PER_TICK)

export const DEFAULT_GLIDE_CONFIG: GlideConfig = {
  climbConversionPerSecond: GLIDE_CLIMB_CONVERSION_PER_SECOND,
  climbLiftMultiplier: GLIDE_CLIMB_LIFT_MULTIPLIER,
  diveConversionPerSecond: GLIDE_DIVE_CONVERSION_PER_SECOND,
  gravityPerSecondSquared: GLIDE_GRAVITY_PER_SECOND_SQUARED,
  horizontalDragPerSecond: GLIDE_HORIZONTAL_DRAG_PER_SECOND,
  liftCancelFactor: GLIDE_LIFT_CANCEL_FACTOR,
  turnRatePerSecond: GLIDE_TURN_RATE_PER_SECOND,
  verticalDragPerSecond: GLIDE_VERTICAL_DRAG_PER_SECOND,
}

/**
 * One glide step of velocity change. Pure: no clock, no equip/durability/
 * grounded check (the caller's job — see the module header).
 */
export const glideStep = (
  velocity: Position,
  sight: GlideSight,
  deltaTime: DeltaTimeSecs,
  config: GlideConfig = DEFAULT_GLIDE_CONFIG,
): Position => {
  const seconds = nonNegativeFinite(deltaTime)
  const vx0 = finiteOrZero(velocity.x)
  const vy0 = finiteOrZero(velocity.y)
  const vz0 = finiteOrZero(velocity.z)
  const pitch = finiteOrZero(sight.pitchRadians)
  const yaw = finiteOrZero(sight.yawRadians)

  const cosPitch = Math.cos(pitch)
  const sinPitch = Math.sin(pitch)
  /*
   * Same look-vector convention as `launchProjectile` (domain/projectile.ts):
   * positive pitch looks down, yaw 0 faces -Z.
   */
  const lookX = -Math.sin(yaw) * cosPitch
  const lookZ = -Math.cos(yaw) * cosPitch
  const horizontalLookLength = Math.hypot(lookX, lookZ)

  /*
   * Gravity, cancelled most at level flight and least at the pitch extremes —
   * this is what makes gliding "float" instead of falling.
   */
  const gravity = finiteOrZero(config.gravityPerSecondSquared)
  const liftCancelFactor = clamp01(finiteOrZero(config.liftCancelFactor))
  const cosPitchSquared = cosPitch * cosPitch
  const effectiveGravity = gravity * (1 - liftCancelFactor * cosPitchSquared)
  let vy = vy0 + effectiveGravity * seconds

  /*
   * Diving converts descent into forward speed. Flat rate * dt, never scaled
   * by the existing speed, so repeated steps converge to a fixed point
   * instead of compounding (see the module header and its property test).
   */
  const diveConversion = nonNegativeFinite(config.diveConversionPerSecond)
  const divePush = diveConversion * Math.max(0, sinPitch) * seconds
  /*
   * `cos(pitch)` of a finite double is never exactly 0 (cos of the doubles
   * nearest pi/2 is ~6.1e-17), so the horizontal look length is always
   * positive and the normalisation cannot divide by zero.
   */
  let vx = vx0 + (lookX / horizontalLookLength) * divePush
  let vz = vz0 + (lookZ / horizontalLookLength) * divePush

  // Climbing spends horizontal speed to gain altitude.
  const climbConversion = nonNegativeFinite(config.climbConversionPerSecond)
  const climbLiftMultiplier = nonNegativeFinite(config.climbLiftMultiplier)
  const horizontalSpeed = Math.hypot(vx, vz)
  const climbRate = climbConversion * Math.max(0, -sinPitch) * seconds
  const climbPull = Math.min(horizontalSpeed, climbRate * horizontalSpeed)
  if (horizontalSpeed > 0) {
    const remaining = (horizontalSpeed - climbPull) / horizontalSpeed
    vx *= remaining
    vz *= remaining
  }
  vy += climbPull * climbLiftMultiplier

  /*
   * Turn: blend the horizontal direction toward the look direction at a rate
   * independent of speed — the continuous-time analogue of a per-tick
   * fractional approach (see `decayRatePerSecond`).
   */
  const turnRate = nonNegativeFinite(config.turnRatePerSecond)
  const turnBlend = 1 - Math.exp(-turnRate * seconds)
  const speedAfterConversion = Math.hypot(vx, vz)
  if (speedAfterConversion > 0 && horizontalLookLength > 0) {
    const targetX = (lookX / horizontalLookLength) * speedAfterConversion
    const targetZ = (lookZ / horizontalLookLength) * speedAfterConversion
    vx += (targetX - vx) * turnBlend
    vz += (targetZ - vz) * turnBlend
  }

  // Drag, continuous form: `applyFluidMotion` (domain/fluid.ts) uses the same
  // `exp(-rate * seconds)` idiom for a per-second drag coefficient.
  const horizontalDrag = Math.exp(-nonNegativeFinite(config.horizontalDragPerSecond) * seconds)
  const verticalDrag = Math.exp(-nonNegativeFinite(config.verticalDragPerSecond) * seconds)
  vx *= horizontalDrag
  vz *= horizontalDrag
  vy *= verticalDrag

  return { x: finiteOrZero(vx), y: finiteOrZero(vy), z: finiteOrZero(vz) }
}
