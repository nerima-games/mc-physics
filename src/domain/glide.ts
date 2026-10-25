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
import { AngleRadians, DeltaTimeSecs, tickDuration } from '@nerima-games/mc-kernel'
import { BlocksPerSecond, BlocksPerSecondSquared, PerSecond, type VelocityVector } from './physical-units.js'
import { Brand, Option, Result } from 'effect'

/** Look direction as pitch/yaw — same fields as `ArrowLaunch` (`domain/projectile.ts`) and `MovementInput.yawRadians`. */
export type GlideSight = Readonly<{
  readonly pitchRadians: AngleRadians
  readonly yawRadians: AngleRadians
}>

export type GlideConfig = Readonly<{
  readonly gravityPerSecondSquared: BlocksPerSecondSquared
  readonly liftCancelFactor: number
  readonly diveConversionPerSecond: BlocksPerSecondSquared
  readonly climbConversionPerSecond: PerSecond
  readonly climbLiftMultiplier: number
  readonly turnRatePerSecond: PerSecond
  readonly horizontalDragPerSecond: PerSecond
  readonly verticalDragPerSecond: PerSecond
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
const TICK_DURATION = tickDuration

/** A per-tick multiplicative decay `perTick = exp(-rate * TICK_SECONDS)`, solved for the continuous per-second rate. */
const decayRatePerSecond = (perTick: number): number => -Math.log(perTick) / TICK_DURATION

/** Per-tick keep-factors from the community-reversed decompile (see the module header). */
const TURN_KEEP_PER_TICK = 0.9
const HORIZONTAL_DRAG_KEEP_PER_TICK = 0.99
const VERTICAL_DRAG_KEEP_PER_TICK = 0.98
const GLIDE_GRAVITY_PER_SECOND_SQUARED_VALUE = -1.6
const GLIDE_DIVE_CONVERSION_PER_SECOND_VALUE = 0.8
const GLIDE_CLIMB_CONVERSION_PER_SECOND_VALUE = 0.8

/** -0.08/tick (community-reversed elytra gravity — see module header) converted to a per-second rate. */
export const GLIDE_GRAVITY_PER_SECOND_SQUARED: BlocksPerSecondSquared = BlocksPerSecondSquared(GLIDE_GRAVITY_PER_SECOND_SQUARED_VALUE)
/** Fraction of gravity cancelled at pitch 0 (level flight); the rest is the residual glide-down rate. */
export const GLIDE_LIFT_CANCEL_FACTOR = 0.9
/** Flat, dt-scaled forward-speed gain from a downward look. Independent of current speed, so it cannot compound step over step — see the "cannot compound" property test. */
export const GLIDE_DIVE_CONVERSION_PER_SECOND: BlocksPerSecondSquared = BlocksPerSecondSquared(GLIDE_DIVE_CONVERSION_PER_SECOND_VALUE)
/** Horizontal-speed-to-lift conversion rate while climbing, on the same 0.04/tick order as the dive conversion. */
export const GLIDE_CLIMB_CONVERSION_PER_SECOND: PerSecond = PerSecond(GLIDE_CLIMB_CONVERSION_PER_SECOND_VALUE)
/** Unitless: how much of the horizontal speed spent climbing becomes vertical speed. */
export const GLIDE_CLIMB_LIFT_MULTIPLIER = 3.5
/** A 10%-per-tick turn-toward-look-direction blend, continuised. */
export const GLIDE_TURN_RATE_PER_SECOND: PerSecond = PerSecond(decayRatePerSecond(TURN_KEEP_PER_TICK))
/** Community-reversed per-tick horizontal air drag, continuised. */
export const GLIDE_HORIZONTAL_DRAG_PER_SECOND: PerSecond = PerSecond(decayRatePerSecond(HORIZONTAL_DRAG_KEEP_PER_TICK))
/** Community-reversed per-tick vertical air drag, continuised. */
export const GLIDE_VERTICAL_DRAG_PER_SECOND: PerSecond = PerSecond(decayRatePerSecond(VERTICAL_DRAG_KEEP_PER_TICK))

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
  velocity: VelocityVector,
  sight: GlideSight,
  deltaTime: DeltaTimeSecs,
  config: GlideConfig = DEFAULT_GLIDE_CONFIG,
): Result.Result<VelocityVector, Brand.BrandError> => {
  const vxSnapshot = velocity.x
  const vySnapshot = velocity.y
  const vzSnapshot = velocity.z
  const pitchSnapshot = sight.pitchRadians
  const yawSnapshot = sight.yawRadians
  const deltaSnapshot = deltaTime
  const gravitySnapshot = config.gravityPerSecondSquared
  const diveConversionSnapshot = config.diveConversionPerSecond
  const climbConversionSnapshot = config.climbConversionPerSecond
  const turnRateSnapshot = config.turnRatePerSecond
  const horizontalDragSnapshot = config.horizontalDragPerSecond
  const verticalDragSnapshot = config.verticalDragPerSecond
  const inputs = Result.all([
    BlocksPerSecond.result(vxSnapshot),
    BlocksPerSecond.result(vySnapshot),
    BlocksPerSecond.result(vzSnapshot),
    DeltaTimeSecs.result(deltaSnapshot),
    BlocksPerSecondSquared.result(gravitySnapshot),
    BlocksPerSecondSquared.result(diveConversionSnapshot),
    PerSecond.result(climbConversionSnapshot),
    PerSecond.result(turnRateSnapshot),
    PerSecond.result(horizontalDragSnapshot),
    PerSecond.result(verticalDragSnapshot),
  ])

  return Result.flatMap(inputs, ([vx0, vy0, vz0, seconds, gravityValue, diveConversionValue, climbConversionValue, turnRateValue, horizontalDragValue, verticalDragValue]) => {
    const pitchOption = AngleRadians.option(pitchSnapshot)
    const yawOption = AngleRadians.option(yawSnapshot)
    let pitch = 0
    if (Option.isSome(pitchOption)) {
      pitch = pitchOption.value
    }
    let yaw = 0
    if (Option.isSome(yawOption)) {
      yaw = yawOption.value
    }
    const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch)
    /*
     * Same look-vector convention as `launchProjectile` (domain/projectile.ts):
     * positive pitch looks down, yaw 0 faces -Z.
     */
    const lookX = -Math.sin(yaw) * cosPitch
    const lookZ = -Math.cos(yaw) * cosPitch
    const horizontalLookLength = Math.hypot(lookX, lookZ)

    const gravity = gravityValue
    const liftCancelFactor = clamp01(finiteOrZero(config.liftCancelFactor))
    const cosPitchSquared = cosPitch * cosPitch
    const effectiveGravity = gravity * (1 - liftCancelFactor * cosPitchSquared)
    let vy = vy0 + effectiveGravity * seconds

    const diveConversion = nonNegativeFinite(diveConversionValue)
    const divePush = diveConversion * Math.max(0, sinPitch) * seconds
    let vx = vx0 + (lookX / horizontalLookLength) * divePush
    let vz = vz0 + (lookZ / horizontalLookLength) * divePush

    const climbConversion = nonNegativeFinite(climbConversionValue)
    const climbLiftMultiplier = nonNegativeFinite(finiteOrZero(config.climbLiftMultiplier))
    const horizontalSpeed = Math.hypot(vx, vz)
    const climbRate = climbConversion * Math.max(0, -sinPitch) * seconds
    const climbPull = Math.min(horizontalSpeed, climbRate * horizontalSpeed)
    if (horizontalSpeed > 0) {
      const remaining = (horizontalSpeed - climbPull) / horizontalSpeed
      vx *= remaining
      vz *= remaining
    }
    vy += climbPull * climbLiftMultiplier

    const turnRate = nonNegativeFinite(turnRateValue)
    const turnBlend = 1 - Math.exp(-turnRate * seconds)
    const speedAfterConversion = Math.hypot(vx, vz)
    if (speedAfterConversion > 0 && horizontalLookLength > 0) {
      const targetX = (lookX / horizontalLookLength) * speedAfterConversion
      const targetZ = (lookZ / horizontalLookLength) * speedAfterConversion
      vx += (targetX - vx) * turnBlend
      vz += (targetZ - vz) * turnBlend
    }

    const horizontalDrag = Math.exp(-nonNegativeFinite(horizontalDragValue) * seconds)
    const verticalDrag = Math.exp(-nonNegativeFinite(verticalDragValue) * seconds)
    vx *= horizontalDrag
    vz *= horizontalDrag
    vy *= verticalDrag

    return Result.map(
      Result.all([
        BlocksPerSecond.result(vx),
        BlocksPerSecond.result(vy),
        BlocksPerSecond.result(vz),
      ]),
      ([nextVx, nextVy, nextVz]): VelocityVector => ({ x: nextVx, y: nextVy, z: nextVz }),
    )
  })
}
