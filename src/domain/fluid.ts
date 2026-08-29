import type { FluidEffects, FluidMotionCoefficients } from './environment-types'
import type { Body } from './integrate'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'

const nonNegativeFinite = (value: number): number => {
  if (Number.isFinite(value)) {
    return Math.max(0, value)
  }
  return 0
}

const volume = (value: number): number => Math.min(1, nonNegativeFinite(value))

const finiteOrZero = (value: number): number => {
  if (Number.isFinite(value)) {
    return value
  }
  return 0
}

export const applyFluidMotion = (
  body: Body,
  deltaTime: DeltaTimeSecs,
  effects: FluidEffects,
  coefficients: FluidMotionCoefficients,
): Body => {
  if (body.kind !== 'dynamic') {
    return body
  }

  const seconds = nonNegativeFinite(deltaTime)
  const waterVolume = volume(effects.waterVolume)
  const lavaVolume = volume(effects.lavaVolume)
  const dragPerSecond = waterVolume * nonNegativeFinite(coefficients.water.dragPerSecond) +
    lavaVolume * nonNegativeFinite(coefficients.lava.dragPerSecond)
  const buoyancyAcceleration = waterVolume * nonNegativeFinite(coefficients.water.buoyancyAcceleration) +
    lavaVolume * nonNegativeFinite(coefficients.lava.buoyancyAcceleration)
  const flowAcceleration = waterVolume * nonNegativeFinite(coefficients.water.flowAcceleration) +
    lavaVolume * nonNegativeFinite(coefficients.lava.flowAcceleration)
  const dragMultiplier = Math.exp(-dragPerSecond * seconds)
  const flowX = finiteOrZero(effects.flow.x)
  const flowY = finiteOrZero(effects.flow.y)
  const flowZ = finiteOrZero(effects.flow.z)

  return {
    ...body,
    vx: body.vx * dragMultiplier + flowX * flowAcceleration * seconds,
    vy: body.vy * dragMultiplier + buoyancyAcceleration * seconds + flowY * flowAcceleration * seconds,
    vz: body.vz * dragMultiplier + flowZ * flowAcceleration * seconds,
  }
}
