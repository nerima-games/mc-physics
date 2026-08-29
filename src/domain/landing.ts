import type { Body } from './integrate'
import type { Resolution } from './resolve-types'

export type LandingImpact = Readonly<{
  readonly fallDistance: number
  readonly impactVelocityY: number
}>

export type FallTrackingState = Readonly<{
  readonly accumulatedFallDistance: number
  readonly isGrounded: boolean
}>

export type FallTrackingTransition = Readonly<{
  readonly state: FallTrackingState
  readonly landingImpact: LandingImpact | null
}>

const nonNegativeFinite = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, value)
}

const isDescending = (velocityY: number): boolean => Number.isFinite(velocityY) && velocityY < 0

export const createFallTrackingState = (isGrounded = false): FallTrackingState => ({
  accumulatedFallDistance: 0,
  isGrounded,
})

export const resetFallTrackingState = (isGrounded = false): FallTrackingState =>
  createFallTrackingState(isGrounded)

export const advanceFallTracking = (
  state: FallTrackingState,
  bodyBeforeIntegration: Body,
  integratedBody: Body,
  resolution: Resolution,
): FallTrackingTransition => {
  const downwardDistance = nonNegativeFinite(bodyBeforeIntegration.y - resolution.body.y)
  let priorFallDistance = 0
  if (!state.isGrounded) {
    priorFallDistance = nonNegativeFinite(state.accumulatedFallDistance)
  }
  const descending = isDescending(integratedBody.vy)
  let fallDistance = 0
  if (descending) {
    fallDistance = priorFallDistance + downwardDistance
  }
  let landingImpact: LandingImpact | null = null
  if (!state.isGrounded && resolution.isGrounded && descending && fallDistance > 0) {
    landingImpact = { fallDistance, impactVelocityY: integratedBody.vy }
  }
  let accumulatedFallDistance = fallDistance
  if (resolution.isGrounded || !descending) {
    accumulatedFallDistance = 0
  }

  return {
    landingImpact,
    state: {
      accumulatedFallDistance,
      isGrounded: resolution.isGrounded,
    },
  }
}
