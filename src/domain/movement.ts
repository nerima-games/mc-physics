import { AngleRadians, DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { BlocksPerSecond, BlocksPerSecondSquared, type VelocityVector } from './physical-units.js'
import { Brand, Option, Result } from 'effect'
import type { Body } from './integrate.js'

export type MovementInput = Readonly<{
  readonly forward: number
  readonly strafe: number
  readonly yawRadians: AngleRadians
  readonly sprint: boolean
  readonly sneak: boolean
  readonly jumpPressed: boolean
}>

export type MovementConfig = Readonly<{
  readonly walkSpeed: BlocksPerSecond
  readonly sprintMultiplier: number
  readonly sneakMultiplier: number
  readonly groundAcceleration: BlocksPerSecondSquared
  readonly airAcceleration: BlocksPerSecondSquared
  readonly jumpVelocity: BlocksPerSecond
  /** Java: ~0.04 blocks/tick^2 swim-up accel x 20 ticks/s = 0.8 blocks/s^2 (per-second unit). */
  readonly fluidAscentAcceleration: BlocksPerSecondSquared
  /** Java: ~0.2 blocks/tick swim-up cap x 20 ticks/s = 4 blocks/s (per-second unit). */
  readonly fluidAscentMaxSpeed: BlocksPerSecond
}>

const finiteOrZero = (value: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return 0
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const approach = (current: number, target: number, maximumChange: number): number => {
  const delta = target - current
  if (Math.abs(delta) <= maximumChange) {
    if (target === 0) {
      return 0
    }
    return target
  }
  const next = current + Math.sign(delta) * maximumChange
  if (next === 0) {
    return 0
  }
  return next
}

export const applyMovementInput = (
  body: Body,
  input: MovementInput,
  isGrounded: boolean,
  inFluid: boolean,
  deltaTime: DeltaTimeSecs,
  config: MovementConfig,
): Result.Result<Body, Brand.BrandError> => {
  if (body.kind !== 'dynamic') {
    return Result.succeed(body)
  }

  const forwardSnapshot = input.forward
  const strafeSnapshot = input.strafe
  const yawSnapshot = input.yawRadians
  const sprintSnapshot = input.sprint
  const sneakSnapshot = input.sneak
  const jumpPressedSnapshot = input.jumpPressed
  const walkSpeedSnapshot = config.walkSpeed
  const sprintMultiplierSnapshot = config.sprintMultiplier
  const sneakMultiplierSnapshot = config.sneakMultiplier
  const groundAccelerationSnapshot = config.groundAcceleration
  const airAccelerationSnapshot = config.airAcceleration
  const jumpVelocitySnapshot = config.jumpVelocity
  const fluidAscentAccelerationSnapshot = config.fluidAscentAcceleration
  const fluidAscentMaxSpeedSnapshot = config.fluidAscentMaxSpeed
  const deltaSnapshot = deltaTime
  const vxSnapshot = body.vx
  const vySnapshot = body.vy
  const vzSnapshot = body.vz

  const inputs = Result.all([
    BlocksPerSecond.result(vxSnapshot),
    BlocksPerSecond.result(vySnapshot),
    BlocksPerSecond.result(vzSnapshot),
    DeltaTimeSecs.result(deltaSnapshot),
    BlocksPerSecond.result(walkSpeedSnapshot),
    BlocksPerSecondSquared.result(groundAccelerationSnapshot),
    BlocksPerSecondSquared.result(airAccelerationSnapshot),
    BlocksPerSecond.result(jumpVelocitySnapshot),
    BlocksPerSecondSquared.result(fluidAscentAccelerationSnapshot),
    BlocksPerSecond.result(fluidAscentMaxSpeedSnapshot),
  ])

  return Result.flatMap(inputs, ([vx, vy, vz, secondsValue, walkSpeedValue, groundAccelerationValue, airAccelerationValue, jumpVelocityValue, fluidAscentAccelerationValue, fluidAscentMaxSpeedValue]) => {
    const forward = clamp(finiteOrZero(forwardSnapshot), -1, 1)
    const strafe = clamp(finiteOrZero(strafeSnapshot), -1, 1)
    const inputLength = Math.hypot(forward, strafe)
    let inputScale = 1
    if (inputLength > 1) {
      inputScale = 1 / inputLength
    }
    const yawOption = AngleRadians.option(yawSnapshot)
    let yaw = 0
    if (Option.isSome(yawOption)) {
      yaw = yawOption.value
    }
    const directionX = (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * inputScale
    const directionZ = (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * inputScale
    const walkSpeed = Math.max(0, walkSpeedValue)
    const sprintMultiplier = Math.max(0, finiteOrZero(sprintMultiplierSnapshot))
    const sneakMultiplier = Math.max(0, finiteOrZero(sneakMultiplierSnapshot))
    let speed = walkSpeed
    if (sneakSnapshot) {
      speed = walkSpeed * sneakMultiplier
    } else if (sprintSnapshot && forward > 0) {
      speed = walkSpeed * sprintMultiplier
    }
    let accelerationValue = airAccelerationValue
    if (isGrounded) {
      accelerationValue = groundAccelerationValue
    }
    const maximumChange = Math.max(0, accelerationValue) * secondsValue
    const nextVx = approach(vx, directionX * speed, maximumChange)
    const nextVz = approach(vz, directionZ * speed, maximumChange)
    let nextVy: number = vy
    if (isGrounded && jumpPressedSnapshot) {
      nextVy = Math.max(vy, Math.max(0, jumpVelocityValue))
    } else if (inFluid && jumpPressedSnapshot && nextVy < Math.max(0, fluidAscentMaxSpeedValue)) {
      nextVy = Math.min(
        Math.max(0, fluidAscentMaxSpeedValue),
        nextVy + Math.max(0, fluidAscentAccelerationValue) * secondsValue,
      )
    }

    return Result.map(
      Result.all([
        BlocksPerSecond.result(nextVx),
        BlocksPerSecond.result(nextVy),
        BlocksPerSecond.result(nextVz),
      ]),
      ([validVx, validVy, validVz]): Body => ({ ...body, vx: validVx, vy: validVy, vz: validVz }),
    )
  })
}

export const applyKnockback = (body: Body, impulse: VelocityVector): Result.Result<Body, Brand.BrandError> => {
  if (body.kind !== 'dynamic') {
    return Result.succeed(body)
  }

  const bodyVxSnapshot = body.vx
  const bodyVySnapshot = body.vy
  const bodyVzSnapshot = body.vz
  const impulseXSnapshot = impulse.x
  const impulseYSnapshot = impulse.y
  const impulseZSnapshot = impulse.z
  const values = Result.all([
    BlocksPerSecond.result(bodyVxSnapshot),
    BlocksPerSecond.result(bodyVySnapshot),
    BlocksPerSecond.result(bodyVzSnapshot),
    BlocksPerSecond.result(impulseXSnapshot),
    BlocksPerSecond.result(impulseYSnapshot),
    BlocksPerSecond.result(impulseZSnapshot),
  ])
  return Result.flatMap(values, ([vx, vy, vz, impulseX, impulseY, impulseZ]) =>
    Result.map(
      Result.all([
        BlocksPerSecond.result(vx + impulseX),
        BlocksPerSecond.result(vy + impulseY),
        BlocksPerSecond.result(vz + impulseZ),
      ]),
      ([nextVx, nextVy, nextVz]): Body => ({ ...body, vx: nextVx, vy: nextVy, vz: nextVz }),
    ),
  )
}
