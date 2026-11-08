import { AngleRadians, BlockId, PositionAxis } from '@nerima-games/mc-kernel'
import { BlocksPerSecond, BlocksPerSecondSquared, type VelocityVector } from './physical-units.js'
import { Brand, Result } from 'effect'
import type { Body } from './integrate.js'
import { CentreY } from './coordinates.js'

export type MovementInput = Readonly<{
  readonly forward: number
  readonly strafe: number
  readonly yawRadians: number
  readonly sprint: boolean
  readonly sneak: boolean
  readonly jumpPressed: boolean
}>

export type MovementFactor = number & Brand.Brand<'MovementFactor'>
export const MovementFactor: Brand.Constructor<MovementFactor> = Brand.make<MovementFactor>(
  (value) => (Number.isFinite(value) && value >= 0) || 'MovementFactor must be a non-negative finite number',
)

export type MovementConfig = Readonly<{
  readonly sprintMultiplier: MovementFactor
  readonly sneakMultiplier: MovementFactor
  readonly groundAcceleration: BlocksPerSecondSquared
  readonly airAcceleration: BlocksPerSecondSquared
  readonly jumpVelocity: BlocksPerSecond
  readonly fluidAscentAcceleration: BlocksPerSecondSquared
  readonly fluidAscentMaxSpeed: BlocksPerSecond
  readonly climbSpeed: BlocksPerSecond
  readonly climbDescentMaxSpeed: BlocksPerSecond
}>

export type MovementCoefficients = Readonly<{
  readonly groundSlipperiness: MovementFactor
  readonly inputAccelerationMultiplier: MovementFactor
  readonly horizontalMomentumMultiplier: MovementFactor
  readonly verticalMomentumMultiplier: MovementFactor
  readonly climbable: boolean
}>

export type MovementContext = Readonly<{
  readonly isGrounded: boolean
  readonly inFluid: boolean
  readonly climbable: boolean
  /** The block supporting the entity, used to select ground slipperiness. */
  readonly surfaceBlockId: BlockId | null
  /** Blocks touching the entity, used for drag and climbable behavior. */
  readonly movementBlockIds: ReadonlyArray<BlockId>
}>

const TICKS_PER_SECOND = 20
const BLOCKS_PER_TICK = 1 / TICKS_PER_SECOND
const SPRINT_MULTIPLIER = 1.3
const SNEAK_MULTIPLIER = 0.3
const GROUND_ACCELERATION = 39.2
const AIR_ACCELERATION = 8
const JUMP_VELOCITY = 8.4
const FLUID_ASCENT_ACCELERATION = 0.8
const FLUID_ASCENT_MAX_SPEED = 4
const CLIMB_SPEED = 2.35
const CLIMB_DESCENT_MAX_SPEED = 3
const BASE_GROUND_SLIPPERINESS = 0.6
const GROUND_FRICTION_FACTOR = 0.91
const BASE_GROUND_FRICTION = BASE_GROUND_SLIPPERINESS * GROUND_FRICTION_FACTOR
const AIR_FRICTION = 0.91
const CLIMBABLE_SLIPPERINESS = 0.98
const CLIMBABLE_FRICTION = CLIMBABLE_SLIPPERINESS * GROUND_FRICTION_FACTOR
const ICE_SLIPPERINESS = 0.98
const LADDER_BLOCK_ID_VALUE = 18
const COBWEB_BLOCK_ID_VALUE = 19
const SOUL_SAND_BLOCK_ID_VALUE = 47
const ICE_BLOCK_ID_VALUE = 48
const BLOCK_ID_LADDER = BlockId(LADDER_BLOCK_ID_VALUE)
const BLOCK_ID_COBWEB = BlockId(COBWEB_BLOCK_ID_VALUE)
const BLOCK_ID_SOUL_SAND = BlockId(SOUL_SAND_BLOCK_ID_VALUE)
const BLOCK_ID_ICE = BlockId(ICE_BLOCK_ID_VALUE)
const COBWEB_HORIZONTAL_MOMENTUM = 0.25
const COBWEB_VERTICAL_MOMENTUM = 0.05
const SOUL_SAND_SPEED = 2.508
const WALK_SPEED = 4.317
const MAX_CLIMBABLE_HORIZONTAL_SPEED = 3
const GROUND_FRICTION_EXPONENT = 3

export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = {
  airAcceleration: BlocksPerSecondSquared(AIR_ACCELERATION),
  climbDescentMaxSpeed: BlocksPerSecond(CLIMB_DESCENT_MAX_SPEED),
  climbSpeed: BlocksPerSecond(CLIMB_SPEED),
  fluidAscentAcceleration: BlocksPerSecondSquared(FLUID_ASCENT_ACCELERATION),
  fluidAscentMaxSpeed: BlocksPerSecond(FLUID_ASCENT_MAX_SPEED),
  groundAcceleration: BlocksPerSecondSquared(GROUND_ACCELERATION),
  jumpVelocity: BlocksPerSecond(JUMP_VELOCITY),
  sneakMultiplier: MovementFactor(SNEAK_MULTIPLIER),
  sprintMultiplier: MovementFactor(SPRINT_MULTIPLIER),
}

const DEFAULT_MOVEMENT_COEFFICIENTS: MovementCoefficients = {
  climbable: false,
  groundSlipperiness: MovementFactor(BASE_GROUND_SLIPPERINESS),
  horizontalMomentumMultiplier: MovementFactor(1),
  inputAccelerationMultiplier: MovementFactor(1),
  verticalMomentumMultiplier: MovementFactor(1),
}

const MOVEMENT_COEFFICIENTS_BY_BLOCK_ID: Readonly<Partial<Record<number, MovementCoefficients>>> = {
  [BLOCK_ID_LADDER]: {
    ...DEFAULT_MOVEMENT_COEFFICIENTS,
    climbable: true,
  },
  [BLOCK_ID_COBWEB]: {
    ...DEFAULT_MOVEMENT_COEFFICIENTS,
    horizontalMomentumMultiplier: MovementFactor(COBWEB_HORIZONTAL_MOMENTUM),
    verticalMomentumMultiplier: MovementFactor(COBWEB_VERTICAL_MOMENTUM),
  },
  [BLOCK_ID_SOUL_SAND]: {
    ...DEFAULT_MOVEMENT_COEFFICIENTS,
    inputAccelerationMultiplier: MovementFactor(SOUL_SAND_SPEED / WALK_SPEED),
  },
  [BLOCK_ID_ICE]: {
    ...DEFAULT_MOVEMENT_COEFFICIENTS,
    groundSlipperiness: MovementFactor(ICE_SLIPPERINESS),
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const finiteNonNegative = (value: number, name: string): Result.Result<number, RangeError> => {
  if (!Number.isFinite(value) || value < 0) {
    return Result.fail(new RangeError(`${name} must be a non-negative finite number`))
  }
  return Result.succeed(value)
}

export const validateMovementBody = (value: unknown): Result.Result<Body, Brand.BrandError | RangeError> => {
  if (!isRecord(value)) {
    return Result.fail(new RangeError('body must be an object'))
  }
  const { kind, x, y, z, vx, vy, vz } = value
  if (kind !== 'dynamic' && kind !== 'static' && kind !== 'kinematic') {
    return Result.fail(new RangeError('body kind is invalid'))
  }
  if (
    !isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z) ||
    !isFiniteNumber(vx) || !isFiniteNumber(vy) || !isFiniteNumber(vz)
  ) {
    return Result.fail(new RangeError('body coordinates and velocity must be finite numbers'))
  }
  const checked = Result.all([
    PositionAxis.result(x),
    CentreY.result(y),
    PositionAxis.result(z),
    BlocksPerSecond.result(vx),
    BlocksPerSecond.result(vy),
    BlocksPerSecond.result(vz),
  ])
  return Result.map(checked, ([validX, validY, validZ, validVx, validVy, validVz]): Body => ({
    kind,
    vx: validVx,
    vy: validVy,
    vz: validVz,
    x: validX,
    y: validY,
    z: validZ,
  }))
}

export const validateMovementInput = (value: unknown): Result.Result<MovementInput, Brand.BrandError | RangeError> => {
  if (!isRecord(value)) {
    return Result.fail(new RangeError('movement input must be an object'))
  }
  const { forward, jumpPressed, sneak, sprint, strafe, yawRadians } = value
  if (!isFiniteNumber(forward)) {
    return Result.fail(new RangeError('forward must be finite'))
  }
  if (!isFiniteNumber(strafe)) {
    return Result.fail(new RangeError('strafe must be finite'))
  }
  if (typeof sprint !== 'boolean' || typeof sneak !== 'boolean' || typeof jumpPressed !== 'boolean') {
    return Result.fail(new RangeError('movement buttons must be booleans'))
  }
  if (!isFiniteNumber(yawRadians)) {
    return Result.fail(new RangeError('yawRadians must be finite'))
  }
  return Result.map(AngleRadians.result(yawRadians), (validYawRadians): MovementInput => ({
    forward,
    jumpPressed,
    sneak,
    sprint,
    strafe,
    yawRadians: validYawRadians,
  }))
}

const validateBlockId = (value: unknown): Result.Result<BlockId, Brand.BrandError | RangeError> => {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return Result.fail(new RangeError('block ID must be a finite integer'))
  }
  return BlockId.result(value)
}

export const validateMovementContext = (value: unknown): Result.Result<MovementContext, Brand.BrandError | RangeError> => {
  if (!isRecord(value)) {
    return Result.fail(new RangeError('movement context must be an object'))
  }
  const {
    climbable,
    inFluid,
    isGrounded,
    movementBlockIds: rawMovementBlockIds,
    surfaceBlockId,
  } = value
  if (typeof isGrounded !== 'boolean' || typeof inFluid !== 'boolean' || typeof climbable !== 'boolean') {
    return Result.fail(new RangeError('movement context flags must be booleans'))
  }
  if (!Array.isArray(rawMovementBlockIds)) {
    return Result.fail(new RangeError('movementBlockIds must be an array'))
  }
  let checkedSurfaceBlockId: Result.Result<BlockId | null, Brand.BrandError | RangeError>
  if (surfaceBlockId === null) {
    checkedSurfaceBlockId = Result.succeed(null)
  } else {
    checkedSurfaceBlockId = validateBlockId(surfaceBlockId)
  }
  const checkedMovementBlockIds = Result.all(rawMovementBlockIds.map(validateBlockId))
  return Result.map(
    Result.all([checkedSurfaceBlockId, checkedMovementBlockIds]),
    ([validSurfaceBlockId, validMovementBlockIds]): MovementContext => ({
      climbable,
      inFluid,
      isGrounded,
      movementBlockIds: validMovementBlockIds,
      surfaceBlockId: validSurfaceBlockId,
    }),
  )
}

export const validateMovementConfig = (value: unknown): Result.Result<MovementConfig, Brand.BrandError | RangeError> => {
  if (!isRecord(value)) {
    return Result.fail(new RangeError('movement config must be an object'))
  }
  const {
    airAcceleration: rawAirAcceleration,
    climbDescentMaxSpeed: rawClimbDescentMaxSpeed,
    climbSpeed: rawClimbSpeed,
    fluidAscentAcceleration: rawFluidAscentAcceleration,
    fluidAscentMaxSpeed: rawFluidAscentMaxSpeed,
    groundAcceleration: rawGroundAcceleration,
    jumpVelocity: rawJumpVelocity,
    sneakMultiplier: rawSneakMultiplier,
    sprintMultiplier: rawSprintMultiplier,
  } = value
  if (
    !isFiniteNumber(rawAirAcceleration) || !isFiniteNumber(rawClimbDescentMaxSpeed) ||
    !isFiniteNumber(rawClimbSpeed) || !isFiniteNumber(rawFluidAscentAcceleration) ||
    !isFiniteNumber(rawFluidAscentMaxSpeed) || !isFiniteNumber(rawGroundAcceleration) ||
    !isFiniteNumber(rawJumpVelocity) || !isFiniteNumber(rawSneakMultiplier) ||
    !isFiniteNumber(rawSprintMultiplier)
  ) {
    return Result.fail(new RangeError('movement config values must be finite numbers'))
  }
  const checked = Result.all([
    BlocksPerSecondSquared.result(rawAirAcceleration),
    BlocksPerSecond.result(rawClimbDescentMaxSpeed),
    BlocksPerSecond.result(rawClimbSpeed),
    BlocksPerSecondSquared.result(rawFluidAscentAcceleration),
    BlocksPerSecond.result(rawFluidAscentMaxSpeed),
    BlocksPerSecondSquared.result(rawGroundAcceleration),
    BlocksPerSecond.result(rawJumpVelocity),
    MovementFactor.result(rawSneakMultiplier),
    MovementFactor.result(rawSprintMultiplier),
  ])
  return Result.flatMap(checked, ([airAcceleration, climbDescentMaxSpeed, climbSpeed, fluidAscentAcceleration, fluidAscentMaxSpeed, groundAcceleration, jumpVelocity, sneakMultiplier, sprintMultiplier]) => {
    const nonNegative = Result.all([
      finiteNonNegative(groundAcceleration, 'groundAcceleration'),
      finiteNonNegative(airAcceleration, 'airAcceleration'),
      finiteNonNegative(jumpVelocity, 'jumpVelocity'),
      finiteNonNegative(fluidAscentAcceleration, 'fluidAscentAcceleration'),
      finiteNonNegative(fluidAscentMaxSpeed, 'fluidAscentMaxSpeed'),
      finiteNonNegative(climbSpeed, 'climbSpeed'),
      finiteNonNegative(climbDescentMaxSpeed, 'climbDescentMaxSpeed'),
    ])
    return Result.map(nonNegative, (): MovementConfig => ({
      airAcceleration,
      climbDescentMaxSpeed,
      climbSpeed,
      fluidAscentAcceleration,
      fluidAscentMaxSpeed,
      groundAcceleration,
      jumpVelocity,
      sneakMultiplier,
      sprintMultiplier,
    }))
  })
}

const coefficientsAt = (blockId: BlockId | null): MovementCoefficients => {
  if (blockId === null) {
    return DEFAULT_MOVEMENT_COEFFICIENTS
  }
  return MOVEMENT_COEFFICIENTS_BY_BLOCK_ID[Number(blockId)] ?? DEFAULT_MOVEMENT_COEFFICIENTS
}

export const movementCoefficientsForBlockId = (
  blockId: unknown,
): Result.Result<MovementCoefficients, Brand.BrandError | RangeError> => {
  if (blockId === null) {
    return Result.succeed(DEFAULT_MOVEMENT_COEFFICIENTS)
  }
  return Result.map(validateBlockId(blockId), coefficientsAt)
}

const contextBlockIds = (context: MovementContext): ReadonlyArray<BlockId> => {
  const ids = new Map<number, BlockId>()
  if (context.surfaceBlockId !== null) {
    ids.set(Number(context.surfaceBlockId), context.surfaceBlockId)
  }
  for (const blockId of context.movementBlockIds) {
    ids.set(Number(blockId), blockId)
  }
  return [...ids.values()]
}

const coefficientsForContext = (context: MovementContext): ReadonlyArray<MovementCoefficients> =>
  contextBlockIds(context).map((blockId) => coefficientsAt(blockId))

const frictionForMovement = (
  context: MovementContext,
  surfaceCoefficients: MovementCoefficients,
  isClimbable: boolean,
): number => {
  if (isClimbable) {
    return CLIMBABLE_FRICTION
  }
  if (context.isGrounded) {
    return Number(surfaceCoefficients.groundSlipperiness) * GROUND_FRICTION_FACTOR
  }
  return AIR_FRICTION
}

const movementIsClimbable = (context: MovementContext, coefficients: ReadonlyArray<MovementCoefficients>): boolean =>
  context.climbable || coefficients.some((value) => value.climbable)

const horizontalMomentumMultiplier = (coefficients: ReadonlyArray<MovementCoefficients>): number =>
  coefficients.reduce((multiplier, value) => multiplier * Number(value.horizontalMomentumMultiplier), 1)

const inputAccelerationMultiplier = (coefficients: ReadonlyArray<MovementCoefficients>): number =>
  coefficients.reduce((multiplier, value) => multiplier * Number(value.inputAccelerationMultiplier), 1)

const verticalMomentumMultiplier = (coefficients: ReadonlyArray<MovementCoefficients>): number =>
  coefficients.reduce((multiplier, value) => multiplier * Number(value.verticalMomentumMultiplier), 1)

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Add one tick of player input using the pre-movement context. */
export const applyMovementInput = (
  body: Body,
  input: MovementInput,
  context: MovementContext,
  config: MovementConfig = DEFAULT_MOVEMENT_CONFIG,
): Result.Result<Body, Brand.BrandError | RangeError> => {
  const checkedBody = validateMovementBody(body)
  if (Result.isFailure(checkedBody)) {
    return Result.fail(checkedBody.failure)
  }
  const checkedInputs = Result.all([
    validateMovementInput(input),
    validateMovementContext(context),
    validateMovementConfig(config),
  ])
  return Result.flatMap(checkedInputs, ([validInput, validContext, validConfig]) => {
    if (checkedBody.success.kind !== 'dynamic') {
      return Result.succeed(body)
    }
    const forward = clamp(validInput.forward, -1, 1)
    const strafe = clamp(validInput.strafe, -1, 1)
    const inputLength = Math.hypot(forward, strafe)
    let inputScale = 1
    if (inputLength > 1) {
      inputScale = 1 / inputLength
    }
    const yaw = Number(validInput.yawRadians)
    const directionX = (-Math.sin(yaw) * forward + Math.cos(yaw) * strafe) * inputScale
    const directionZ = (-Math.cos(yaw) * forward - Math.sin(yaw) * strafe) * inputScale
    const coefficients = coefficientsForContext(validContext)
    const surfaceCoefficients = coefficientsAt(validContext.surfaceBlockId)
    const isClimbable = movementIsClimbable(validContext, coefficients)
    let acceleration = Number(validConfig.airAcceleration) * BLOCKS_PER_TICK
    if (validContext.isGrounded) {
      acceleration = Number(validConfig.groundAcceleration) * BLOCKS_PER_TICK
    }
    const friction = frictionForMovement(validContext, surfaceCoefficients, isClimbable)
    if (validContext.isGrounded) {
      acceleration *= (BASE_GROUND_FRICTION / friction) ** GROUND_FRICTION_EXPONENT
    }
    acceleration *= inputAccelerationMultiplier(coefficients)
    if (isClimbable && friction < 1) {
      const climbableSteadySpeed = acceleration * TICKS_PER_SECOND / (1 - friction)
      if (climbableSteadySpeed > 0) {
        acceleration *= MAX_CLIMBABLE_HORIZONTAL_SPEED / climbableSteadySpeed
      }
    }
    if (validInput.sneak) {
      acceleration *= Number(validConfig.sneakMultiplier)
    } else if (validInput.sprint && forward > 0) {
      acceleration *= Number(validConfig.sprintMultiplier)
    }
    const nextVx = Number(checkedBody.success.vx) + directionX * acceleration
    const nextVz = Number(checkedBody.success.vz) + directionZ * acceleration
    let nextVy = Number(checkedBody.success.vy)
    if (validContext.isGrounded && validInput.jumpPressed) {
      nextVy = Math.max(nextVy, Number(validConfig.jumpVelocity))
    } else if (validContext.inFluid && validInput.jumpPressed && nextVy < Number(validConfig.fluidAscentMaxSpeed)) {
      nextVy = Math.min(
        Number(validConfig.fluidAscentMaxSpeed),
        nextVy + Number(validConfig.fluidAscentAcceleration) * BLOCKS_PER_TICK,
      )
    }
    if (isClimbable) {
      if (validInput.forward > 0 || validInput.jumpPressed) {
        nextVy = Math.max(nextVy, Number(validConfig.climbSpeed))
      }
      nextVy = Math.max(nextVy, -Number(validConfig.climbDescentMaxSpeed))
      if (validInput.sneak && nextVy < 0) {
        nextVy = 0
      }
    }
    return Result.map(
      Result.all([
        BlocksPerSecond.result(nextVx),
        BlocksPerSecond.result(nextVy),
        BlocksPerSecond.result(nextVz),
      ]),
      ([vx, vy, vz]): Body => ({ ...checkedBody.success, vx, vy, vz }),
    )
  })
}

/** Apply friction after movement using context refreshed from the resolved body. */
export const applyMovementFriction = (
  body: Body,
  input: MovementInput,
  context: MovementContext,
  config: MovementConfig = DEFAULT_MOVEMENT_CONFIG,
): Result.Result<Body, Brand.BrandError | RangeError> => {
  const checkedBody = validateMovementBody(body)
  if (Result.isFailure(checkedBody)) {
    return Result.fail(checkedBody.failure)
  }
  const checkedInputs = Result.all([
    validateMovementInput(input),
    validateMovementContext(context),
    validateMovementConfig(config),
  ])
  return Result.flatMap(checkedInputs, ([validInput, validContext, validConfig]) => {
    if (checkedBody.success.kind !== 'dynamic') {
      return Result.succeed(body)
    }
    const coefficients = coefficientsForContext(validContext)
    const surfaceCoefficients = coefficientsAt(validContext.surfaceBlockId)
    const isClimbable = movementIsClimbable(validContext, coefficients)
    const horizontalMultiplier = frictionForMovement(validContext, surfaceCoefficients, isClimbable) * horizontalMomentumMultiplier(coefficients)
    const verticalMultiplier = verticalMomentumMultiplier(coefficients)
    const nextVx = Number(checkedBody.success.vx) * horizontalMultiplier
    const nextVz = Number(checkedBody.success.vz) * horizontalMultiplier
    let nextVy = Number(checkedBody.success.vy) * verticalMultiplier
    if (isClimbable) {
      if (validInput.forward > 0 || validInput.jumpPressed) {
        nextVy = Math.max(nextVy, Number(validConfig.climbSpeed))
      }
      nextVy = Math.max(nextVy, -Number(validConfig.climbDescentMaxSpeed))
      if (validInput.sneak && nextVy < 0) {
        nextVy = 0
      }
    }
    return Result.map(
      Result.all([
        BlocksPerSecond.result(nextVx),
        BlocksPerSecond.result(nextVy),
        BlocksPerSecond.result(nextVz),
      ]),
      ([vx, vy, vz]): Body => ({ ...checkedBody.success, vx, vy, vz }),
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
