import { type AABB, HalfHeight } from './coordinates.js'
import { BlockLength, BlocksPerSecond } from './physical-units.js'
import { type Body, type IntegrationOptions, integrateBody } from './integrate.js'
import { Brand, Result } from 'effect'
import { DIAMETER_FACTOR, resolveSweptMotionFromValidated } from './resolve-sweep.js'
import { DeltaTimeSecs, PositionAxis } from '@nerima-games/mc-kernel'
import {
  type HasGroundSupport,
  type HorizontalPosition,
  type Resolution,
  type ResolveError,
  type ResolveOptions,
} from './resolve-types.js'
import { clampAxis, resolveVertical } from './resolve-axis.js'
import { isSupported, tryStepUp } from './resolve-support.js'
import { boxAt } from './resolve-shapes.js'
import { sampleBlockHazards } from './environment.js'

export type {
  BlockPropertiesAt,
  BlockShapeAt,
  HasGroundSupport,
  HorizontalPosition,
  Resolution,
  ResolveError,
  ResolveOptions,
} from './resolve-types.js'

export const clampSneakEdge = (
  previous: HorizontalPosition,
  next: HorizontalPosition,
  hasGroundSupport: HasGroundSupport,
): HorizontalPosition => {
  let nextX = next.x
  let nextZ = next.z

  if (next.x !== previous.x && !hasGroundSupport(next.x, previous.z)) {
    nextX = previous.x
  }
  if (next.z !== previous.z && !hasGroundSupport(previous.x, next.z)) {
    nextZ = previous.z
  }

  return { x: nextX, z: nextZ }
}

const validateResolveOptions = (options: ResolveOptions): Result.Result<ResolveOptions, ResolveError> => {
  const {
    halfWidth: halfWidthSnapshot,
    halfHeight: halfHeightSnapshot,
    stepHeight: stepHeightSnapshot,
    environment,
  } = options
  let checkedStepHeight: Result.Result<BlockLength | undefined, Brand.BrandError>
  if (typeof stepHeightSnapshot === 'undefined') {
    checkedStepHeight = Result.succeed(globalThis.undefined)
  } else {
    checkedStepHeight = BlockLength.result(stepHeightSnapshot)
  }
  const checkedDimensions = Result.all([
    BlockLength.result(halfWidthSnapshot),
    HalfHeight.result(halfHeightSnapshot),
    checkedStepHeight,
  ])
  if (Result.isFailure(checkedDimensions)) {
    return Result.fail(checkedDimensions.failure)
  }
  const [halfWidth, halfHeight, stepHeight] = checkedDimensions.success
  if (halfWidth <= 0) {
    return Result.fail(new RangeError('halfWidth must be positive'))
  }
  if (typeof stepHeight !== 'undefined' && stepHeight < 0) {
    return Result.fail(new RangeError('stepHeight must be non-negative'))
  }

  const { blockPropertiesAt, blockShapeAt, bouncinessAt } = options
  let checkedOptions: ResolveOptions = {
    blockPropertiesAt,
    environment,
    halfHeight,
    halfWidth,
  }
  if (typeof bouncinessAt !== 'undefined') {
    checkedOptions = { ...checkedOptions, bouncinessAt }
  }
  if (typeof blockShapeAt !== 'undefined') {
    checkedOptions = { ...checkedOptions, blockShapeAt }
  }
  if (typeof stepHeight !== 'undefined') {
    checkedOptions = { ...checkedOptions, stepHeight }
  }
  return Result.succeed(checkedOptions)
}

const finishResolution = (
  body: Body,
  isGrounded: boolean,
  box: AABB,
  environment: ResolveOptions['environment'],
): Result.Result<Resolution, ResolveError> =>
  Result.map(sampleBlockHazards(box, environment), (hazards): Resolution => ({ body, hazards, isGrounded }))

const resolveBodyWithValidatedOptions = (
  body: Body,
  validDeltaTime: DeltaTimeSecs,
  validOptions: ResolveOptions,
): Result.Result<Resolution, ResolveError> => {
  const initialBox = boxAt(validOptions, body.x, body.y, body.z)
  if (Result.isFailure(initialBox)) {
    return Result.fail(initialBox.failure)
  }

  if (body.kind !== 'dynamic') {
    return Result.flatMap(isSupported(validOptions, initialBox.success), (isGrounded) =>
      finishResolution(body, isGrounded, initialBox.success, validOptions.environment),
    )
  }

  const vertical = resolveVertical(
    validOptions,
    initialBox.success,
    { blocked: false, position: body.y, velocity: body.vy },
    validDeltaTime,
  )
  if (Result.isFailure(vertical)) {
    return Result.fail(vertical.failure)
  }
  const resolvedY = vertical.success.position

  if (body.vx === 0 && body.vz === 0) {
    const verticallyResolved: Body = { ...body, vy: vertical.success.velocity, y: resolvedY }
    const verticalBox = boxAt(validOptions, body.x, resolvedY, body.z)
    if (Result.isFailure(verticalBox)) {
      return Result.fail(verticalBox.failure)
    }
    if (vertical.success.bounced === true) {
      return finishResolution(verticallyResolved, false, verticalBox.success, validOptions.environment)
    }
    if (vertical.success.blocked && body.vy < 0) {
      return finishResolution(verticallyResolved, true, verticalBox.success, validOptions.environment)
    }
    return Result.flatMap(isSupported(validOptions, verticalBox.success), (isGrounded) =>
      finishResolution(verticallyResolved, isGrounded, verticalBox.success, validOptions.environment),
    )
  }

  const boxAfterY = boxAt(validOptions, body.x, resolvedY, body.z)
  if (Result.isFailure(boxAfterY)) {
    return Result.fail(boxAfterY.failure)
  }
  const alongX = clampAxis(
    { blocked: false, position: body.x, velocity: body.vx },
    boxAfterY.success.minX,
    boxAfterY.success.maxX,
    validOptions.halfWidth,
    validOptions,
    boxAfterY.success,
    {
      farFace: (block) => block.maxX,
      nearFace: (block) => block.minX,
      positionResult: PositionAxis.result,
    },
  )
  if (Result.isFailure(alongX)) {
    return Result.fail(alongX.failure)
  }
  const boxAfterX = boxAt(validOptions, alongX.success.position, resolvedY, body.z)
  if (Result.isFailure(boxAfterX)) {
    return Result.fail(boxAfterX.failure)
  }
  const alongZ = clampAxis(
    { blocked: false, position: body.z, velocity: body.vz },
    boxAfterX.success.minZ,
    boxAfterX.success.maxZ,
    validOptions.halfWidth,
    validOptions,
    boxAfterX.success,
    {
      farFace: (block) => block.maxZ,
      nearFace: (block) => block.minZ,
      positionResult: PositionAxis.result,
    },
  )
  if (Result.isFailure(alongZ)) {
    return Result.fail(alongZ.failure)
  }
  const hasStepMovement = alongX.success.blocked || alongZ.success.blocked
  const hasStepHeight = (validOptions.stepHeight ?? 0) > 0
  let stepped: Result.Result<Body | null, ResolveError>
  if (hasStepMovement && hasStepHeight && vertical.success.velocity <= 0) {
    stepped = tryStepUp(body, resolvedY, alongX.success, alongZ.success, vertical.success.velocity, validOptions)
  } else {
    stepped = Result.succeed(null)
  }
  if (Result.isFailure(stepped)) {
    return Result.fail(stepped.failure)
  }
  if (stepped.success !== null) {
    const steppedBody = stepped.success
    return Result.flatMap(boxAt(validOptions, steppedBody.x, steppedBody.y, steppedBody.z), (steppedBox) =>
      Result.flatMap(isSupported(validOptions, steppedBox), (isGrounded) =>
        finishResolution(steppedBody, isGrounded, steppedBox, validOptions.environment),
      ),
    )
  }

  const resolved: Body = {
    kind: 'dynamic',
    vx: alongX.success.velocity,
    vy: vertical.success.velocity,
    vz: alongZ.success.velocity,
    x: alongX.success.position,
    y: resolvedY,
    z: alongZ.success.position,
  }

  /*
   * A bounced body sits exactly where it landed this frame, which
   * `isSupported` (a purely positional check) would read as resting — but its
   * velocity now points away from the surface, so it is not grounded.
   */
  return Result.flatMap(boxAt(validOptions, resolved.x, resolved.y, resolved.z), (resolvedBox) => {
    if (vertical.success.bounced === true) {
      return finishResolution(resolved, false, resolvedBox, validOptions.environment)
    }
    return Result.flatMap(isSupported(validOptions, resolvedBox), (isGrounded) =>
      finishResolution(resolved, isGrounded, resolvedBox, validOptions.environment),
    )
  })
}

export const resolveBody = (
  body: Body,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
): Result.Result<Resolution, ResolveError> => {
  const checkedOptions = validateResolveOptions(options)
  if (Result.isFailure(checkedOptions)) {
    return Result.fail(checkedOptions.failure)
  }
  const checkedDeltaTime = DeltaTimeSecs.result(deltaTime)
  if (Result.isFailure(checkedDeltaTime)) {
    return Result.fail(checkedDeltaTime.failure)
  }
  return resolveBodyWithValidatedOptions(body, checkedDeltaTime.success, checkedOptions.success)
}

export const resolveWorld = (
  bodies: ReadonlyArray<Body>,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
): Result.Result<ReadonlyArray<Resolution>, ResolveError> => {
  const checkedOptions = validateResolveOptions(options)
  if (Result.isFailure(checkedOptions)) {
    return Result.fail(checkedOptions.failure)
  }
  const checkedDeltaTime = DeltaTimeSecs.result(deltaTime)
  if (Result.isFailure(checkedDeltaTime)) {
    return Result.fail(checkedDeltaTime.failure)
  }
  return Result.all(bodies.map((body) =>
    resolveBodyWithValidatedOptions(body, checkedDeltaTime.success, checkedOptions.success),
  ))
}

export const stepBody = (
  body: Body,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
  integration: IntegrationOptions = {},
): Result.Result<Resolution, ResolveError> => {
  const checkedOptions = validateResolveOptions(options)
  if (Result.isFailure(checkedOptions)) {
    return Result.fail(checkedOptions.failure)
  }
  const validOptions = checkedOptions.success
  const checkedDeltaTime = DeltaTimeSecs.result(deltaTime)
  if (Result.isFailure(checkedDeltaTime)) {
    return Result.fail(checkedDeltaTime.failure)
  }
  const validDeltaTime = checkedDeltaTime.success
  const integrated = integrateBody(body, validDeltaTime, integration)
  if (Result.isFailure(integrated)) {
    return Result.fail(integrated.failure)
  }
  let collisionSafe: Result.Result<Body, ResolveError>
  if (body.kind === 'dynamic') {
    collisionSafe = resolveSweptMotionFromValidated(body, integrated.success, validOptions)
  } else {
    collisionSafe = Result.succeed(integrated.success)
  }
  if (Result.isFailure(collisionSafe)) {
    return Result.fail(collisionSafe.failure)
  }
  return resolveBodyWithValidatedOptions(collisionSafe.success, validDeltaTime, validOptions)
}

export const stepWorld = (
  bodies: ReadonlyArray<Body>,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
  integration: IntegrationOptions = {},
): Result.Result<ReadonlyArray<Resolution>, ResolveError> => {
  const checkedOptions = validateResolveOptions(options)
  if (Result.isFailure(checkedOptions)) {
    return Result.fail(checkedOptions.failure)
  }
  const checkedDeltaTime = DeltaTimeSecs.result(deltaTime)
  if (Result.isFailure(checkedDeltaTime)) {
    return Result.fail(checkedDeltaTime.failure)
  }
  return Result.all(bodies.map((body) => stepBody(body, checkedDeltaTime.success, checkedOptions.success, integration)))
}

export const maxSpeedWithoutTunnelling = (
  halfExtent: BlockLength,
  blockThickness: BlockLength,
  maxDeltaSecs: DeltaTimeSecs,
): Result.Result<BlocksPerSecond, Brand.BrandError> => {
  const halfExtentSnapshot = halfExtent
  const blockThicknessSnapshot = blockThickness
  const deltaSnapshot = maxDeltaSecs
  const checkedInputs = Result.all([
    BlockLength.result(halfExtentSnapshot),
    BlockLength.result(blockThicknessSnapshot),
    DeltaTimeSecs.result(deltaSnapshot),
  ])
  if (Result.isFailure(checkedInputs)) {
    return Result.fail(checkedInputs.failure)
  }
  const [validHalfExtent, validBlockThickness, validDelta] = checkedInputs.success
  return BlocksPerSecond.result((validBlockThickness + DIAMETER_FACTOR * validHalfExtent) / validDelta)
}
