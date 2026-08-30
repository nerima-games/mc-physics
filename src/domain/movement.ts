import type { DeltaTimeSecs, Position } from '@nerima-games/mc-kernel'
import type { Body } from './integrate.js'

export type MovementInput = Readonly<{
  readonly forward: number
  readonly strafe: number
  readonly yawRadians: number
  readonly sprint: boolean
  readonly jumpPressed: boolean
}>

export type MovementConfig = Readonly<{
  readonly walkSpeed: number
  readonly sprintMultiplier: number
  readonly groundAcceleration: number
  readonly airAcceleration: number
  readonly jumpVelocity: number
  /** Java: ~0.04 blocks/tick^2 swim-up accel x 20 ticks/s = 0.8 blocks/s^2 (per-second unit). */
  readonly fluidAscentAcceleration: number
  /** Java: ~0.2 blocks/tick swim-up cap x 20 ticks/s = 4 blocks/s (per-second unit). */
  readonly fluidAscentMaxSpeed: number
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
): Body => {
  if (body.kind !== 'dynamic') {
    return body
  }

  const forward = clamp(finiteOrZero(input.forward), -1, 1)
  const strafe = clamp(finiteOrZero(input.strafe), -1, 1)
  const inputLength = Math.hypot(forward, strafe)
  let inputScale = 1
  if (inputLength > 1) {
    inputScale = 1 / inputLength
  }
  const yaw = finiteOrZero(input.yawRadians)
  const directionX = (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * inputScale
  const directionZ = (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * inputScale
  const walkSpeed = Math.max(0, finiteOrZero(config.walkSpeed))
  const sprintMultiplier = Math.max(0, finiteOrZero(config.sprintMultiplier))
  let speed = walkSpeed
  if (input.sprint && forward > 0) {
    speed *= sprintMultiplier
  }
  let accelerationValue = config.airAcceleration
  if (isGrounded) {
    accelerationValue = config.groundAcceleration
  }
  const acceleration = Math.max(0, finiteOrZero(accelerationValue))
  const seconds = Math.max(0, finiteOrZero(deltaTime))
  const maximumChange = acceleration * seconds
  const nextVx = approach(body.vx, directionX * speed, maximumChange)
  const nextVz = approach(body.vz, directionZ * speed, maximumChange)
  const jumpVelocity = Math.max(0, finiteOrZero(config.jumpVelocity))
  const fluidAscentAcceleration = Math.max(0, finiteOrZero(config.fluidAscentAcceleration))
  const fluidAscentMaxSpeed = Math.max(0, finiteOrZero(config.fluidAscentMaxSpeed))
  let nextVy = body.vy
  if (isGrounded && input.jumpPressed) {
    nextVy = Math.max(body.vy, jumpVelocity)
  } else if (inFluid && input.jumpPressed && nextVy < fluidAscentMaxSpeed) {
    nextVy = Math.min(fluidAscentMaxSpeed, nextVy + fluidAscentAcceleration * seconds)
  }

  return { ...body, vx: nextVx, vy: nextVy, vz: nextVz }
}

export const applyKnockback = (body: Body, impulse: Position): Body => {
  if (body.kind !== 'dynamic') {
    return body
  }

  return {
    ...body,
    vx: body.vx + finiteOrZero(impulse.x),
    vy: body.vy + finiteOrZero(impulse.y),
    vz: body.vz + finiteOrZero(impulse.z),
  }
}
