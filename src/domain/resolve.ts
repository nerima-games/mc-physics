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
import { hasGroundSupportWithinStep, isSupported, tryStepUp } from './resolve-support.js'
import type { BlockEnvironment } from './environment-types.js'
import { boxAt } from './resolve-shapes.js'
import { sampleBlockHazards } from './environment.js'

export type {
  BlockPropertiesAt,
  BlockShapeAt,
  BlockShapeStateAt,
  HasGroundSupport,
  HorizontalPosition,
  Resolution,
  ResolveError,
  ResolveOptions,
} from './resolve-types.js'

const MAX_SNEAK_STEP_DOWN = 0.6

/** Java sneaking prevents stepping down more than 0.6 blocks. */
export const SNEAK_EDGE_STEP_HEIGHT: BlockLength = BlockLength(MAX_SNEAK_STEP_DOWN)

export const clampSneakEdge = (
  previous: HorizontalPosition,
  next: HorizontalPosition,
  sneaking: boolean,
  hasGroundSupport: HasGroundSupport,
): Result.Result<HorizontalPosition, ResolveError> => {
  if (!sneaking) {
    return Result.succeed(next)
  }
  return Result.flatMap(hasGroundSupport(next.x, next.z, SNEAK_EDGE_STEP_HEIGHT), (nextIsSupported) => {
    if (nextIsSupported) {
      return Result.succeed(next)
    }
    const candidates: ReadonlyArray<HorizontalPosition> = [
      { x: next.x, z: previous.z },
      { x: previous.x, z: next.z },
    ]
    return Result.map(
      Result.all(candidates.map((candidate) => hasGroundSupport(candidate.x, candidate.z, SNEAK_EDGE_STEP_HEIGHT))),
      (candidateSupport): HorizontalPosition => {
        let best: HorizontalPosition = previous
        let bestDistance = -1
        candidates.forEach((candidate, index) => {
          if (candidateSupport[index]) {
            const dx = Number(candidate.x) - Number(previous.x)
            const dz = Number(candidate.z) - Number(previous.z)
            const distance = dx * dx + dz * dz
            if (distance > bestDistance) {
              best = candidate
              bestDistance = distance
            }
          }
        })
        return best
      },
    )
  })
}

const validateResolveOptions = (options: ResolveOptions): Result.Result<ResolveOptions, ResolveError> => {
  const {
    halfWidth: halfWidthSnapshot,
    halfHeight: halfHeightSnapshot,
    stepHeight: stepHeightSnapshot,
    sneaking: sneakingSnapshot,
    environment,
  } = options
  if (typeof sneakingSnapshot !== 'undefined' && typeof sneakingSnapshot !== 'boolean') {
    return Result.fail(new RangeError('sneaking must be a boolean'))
  }
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

  const { blockPropertiesAt, blockShapeAt, blockShapeStateAt, bouncinessAt } = options
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
  if (typeof blockShapeStateAt !== 'undefined') {
    checkedOptions = { ...checkedOptions, blockShapeStateAt }
  }
  if (typeof stepHeight !== 'undefined') {
    checkedOptions = { ...checkedOptions, stepHeight }
  }
  if (typeof sneakingSnapshot !== 'undefined') {
    checkedOptions = { ...checkedOptions, sneaking: sneakingSnapshot }
  }
  return Result.succeed(checkedOptions)
}

const finishResolution = (
  body: Body,
  isGrounded: boolean,
  box: AABB,
  options: ResolveOptions,
): Result.Result<Resolution, ResolveError> => {
  const { environment, blockShapeAt, blockShapeStateAt } = options
  let environmentWithShapes: BlockEnvironment = environment
  if (typeof environment.blockShapeAt === 'undefined' && typeof blockShapeAt === 'function') {
    environmentWithShapes = { ...environmentWithShapes, blockShapeAt }
  }
  if (typeof environment.blockShapeStateAt === 'undefined' && typeof blockShapeStateAt === 'function') {
    environmentWithShapes = { ...environmentWithShapes, blockShapeStateAt }
  }
  return Result.map(sampleBlockHazards(box, environmentWithShapes), (hazards): Resolution => ({ body, hazards, isGrounded }))
}

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
      finishResolution(body, isGrounded, initialBox.success, validOptions),
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
      return finishResolution(verticallyResolved, false, verticalBox.success, validOptions)
    }
    if (vertical.success.blocked && body.vy < 0) {
      return finishResolution(verticallyResolved, true, verticalBox.success, validOptions)
    }
    return Result.flatMap(isSupported(validOptions, verticalBox.success), (isGrounded) =>
      finishResolution(verticallyResolved, isGrounded, verticalBox.success, validOptions),
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
        finishResolution(steppedBody, isGrounded, steppedBox, validOptions),
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
      return finishResolution(resolved, false, resolvedBox, validOptions)
    }
    return Result.flatMap(isSupported(validOptions, resolvedBox), (isGrounded) =>
      finishResolution(resolved, isGrounded, resolvedBox, validOptions),
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

const clampSneakingMovement = (
  previous: Body,
  next: Body,
  options: ResolveOptions,
): Result.Result<Body, ResolveError> => {
  if (previous.kind !== 'dynamic' || options.sneaking !== true) {
    return Result.succeed(next)
  }
  return Result.flatMap(boxAt(options, previous.x, previous.y, previous.z), (previousBox) =>
    Result.flatMap(isSupported(options, previousBox), (wasGrounded) => {
      if (!wasGrounded) {
        return Result.succeed(next)
      }
      return Result.map(
        clampSneakEdge(
          { x: previous.x, z: previous.z },
          { x: next.x, z: next.z },
          true,
          (positionX, positionZ, maxStepDown) =>
            hasGroundSupportWithinStep(options, positionX, positionZ, previousBox.minY, maxStepDown),
        ),
        (position): Body => {
          const { x: resolvedX, z: resolvedZ } = position
          const { vx: nextVx, vz: nextVz } = next
          let vx = nextVx
          let vz = nextVz
          if (resolvedX !== next.x) {
            vx = BlocksPerSecond(0)
          }
          if (resolvedZ !== next.z) {
            vz = BlocksPerSecond(0)
          }
          return { ...next, vx, vz, x: resolvedX, z: resolvedZ }
        },
      )
    }),
  )
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
  const sneakClamped = clampSneakingMovement(body, integrated.success, validOptions)
  if (Result.isFailure(sneakClamped)) {
    return Result.fail(sneakClamped.failure)
  }
  let collisionSafe: Result.Result<Body, ResolveError>
  if (body.kind === 'dynamic') {
    collisionSafe = resolveSweptMotionFromValidated(body, sneakClamped.success, validOptions)
  } else {
    collisionSafe = Result.succeed(sneakClamped.success)
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
