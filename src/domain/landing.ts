import { BlockLength, BlocksPerSecond } from './physical-units.js'
import { type Brand, Result } from 'effect'
import type { Body } from './integrate.js'
import { CentreY } from './coordinates.js'
import type { Resolution } from './resolve-types.js'

export type LandingImpact = Readonly<{
  readonly fallDistance: BlockLength
  readonly impactVelocityY: BlocksPerSecond
}>

export type FallTrackingState = Readonly<{
  readonly accumulatedFallDistance: BlockLength
  readonly isGrounded: boolean
}>

export type FallTrackingTransition = Readonly<{
  readonly state: FallTrackingState
  readonly landingImpact: LandingImpact | null
}>

const isDescending = (velocityY: number): boolean => Number.isFinite(velocityY) && velocityY < 0

export const createFallTrackingState = (isGrounded = false): FallTrackingState => ({
  accumulatedFallDistance: BlockLength(0),
  isGrounded,
})

export const resetFallTrackingState = (isGrounded = false): FallTrackingState =>
  createFallTrackingState(isGrounded)

export const advanceFallTracking = (
  state: FallTrackingState,
  bodyBeforeIntegration: Body,
  integratedBody: Body,
  resolution: Resolution,
): Result.Result<FallTrackingTransition, Brand.BrandError> => {
  const priorDistanceSnapshot = state.accumulatedFallDistance
  const beforeYSnapshot = bodyBeforeIntegration.y
  const resolvedYSnapshot = resolution.body.y
  const velocitySnapshot = integratedBody.vy
  const checkedInputs = Result.all([
    BlockLength.result(priorDistanceSnapshot),
    CentreY.result(beforeYSnapshot),
    CentreY.result(resolvedYSnapshot),
    BlocksPerSecond.result(velocitySnapshot),
  ])
  if (Result.isFailure(checkedInputs)) {
    return Result.fail(checkedInputs.failure)
  }
  const [priorDistance, beforeY, resolvedY, impactVelocity] = checkedInputs.success
  const downwardDistance = BlockLength.result(Math.max(0, beforeY - resolvedY))
  if (Result.isFailure(downwardDistance)) {
    return Result.fail(downwardDistance.failure)
  }
  let priorFallDistance: Result.Result<BlockLength, Brand.BrandError>
  if (state.isGrounded) {
    priorFallDistance = Result.succeed(BlockLength(0))
  } else {
    priorFallDistance = BlockLength.result(Math.max(0, priorDistance))
  }
  return Result.flatMap(priorFallDistance, (validPriorFallDistance) => {
    const descending = isDescending(impactVelocity)
    let fallDistance: Result.Result<BlockLength, Brand.BrandError>
    if (descending) {
      fallDistance = BlockLength.result(validPriorFallDistance + downwardDistance.success)
    } else {
      fallDistance = BlockLength.result(0)
    }
    if (Result.isFailure(fallDistance)) {
      return Result.fail(fallDistance.failure)
    }
    let landingImpact: LandingImpact | null = null
    if (!state.isGrounded && resolution.isGrounded && descending && fallDistance.success > 0) {
      landingImpact = { fallDistance: fallDistance.success, impactVelocityY: impactVelocity }
    }
    let accumulatedFallDistance: BlockLength
    if (resolution.isGrounded || !descending) {
      accumulatedFallDistance = BlockLength(0)
    } else {
      accumulatedFallDistance = fallDistance.success
    }

    return Result.succeed({
      landingImpact,
      state: {
        accumulatedFallDistance,
        isGrounded: resolution.isGrounded,
      },
    })
  })
}
