import { BlocksPerSecond, BlocksPerSecondSquared, PerSecond } from './physical-units.js'
import { Brand, Result } from 'effect'
import type { FluidEffects, FluidMotionCoefficients } from './environment-types.js'
import type { Body } from './integrate.js'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'

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
): Result.Result<Body, Brand.BrandError> => {
  if (body.kind !== 'dynamic') {
    return Result.succeed(body)
  }

  const deltaSnapshot = deltaTime
  const bodyVxSnapshot = body.vx
  const bodyVySnapshot = body.vy
  const bodyVzSnapshot = body.vz
  const waterDragSnapshot = coefficients.water.dragPerSecond
  let waterDragYSnapshot = waterDragSnapshot
  if (typeof coefficients.water.dragPerSecondY !== 'undefined') {
    waterDragYSnapshot = coefficients.water.dragPerSecondY
  }
  const waterBuoyancySnapshot = coefficients.water.buoyancyAcceleration
  const waterFlowAccelerationSnapshot = coefficients.water.flowAcceleration
  const lavaDragSnapshot = coefficients.lava.dragPerSecond
  let lavaDragYSnapshot = lavaDragSnapshot
  if (typeof coefficients.lava.dragPerSecondY !== 'undefined') {
    lavaDragYSnapshot = coefficients.lava.dragPerSecondY
  }
  const lavaBuoyancySnapshot = coefficients.lava.buoyancyAcceleration
  const lavaFlowAccelerationSnapshot = coefficients.lava.flowAcceleration
  const inputs = Result.all([
    DeltaTimeSecs.result(deltaSnapshot),
    BlocksPerSecond.result(bodyVxSnapshot),
    BlocksPerSecond.result(bodyVySnapshot),
    BlocksPerSecond.result(bodyVzSnapshot),
    PerSecond.result(waterDragSnapshot),
    PerSecond.result(waterDragYSnapshot),
    BlocksPerSecondSquared.result(waterBuoyancySnapshot),
    BlocksPerSecondSquared.result(waterFlowAccelerationSnapshot),
    PerSecond.result(lavaDragSnapshot),
    PerSecond.result(lavaDragYSnapshot),
    BlocksPerSecondSquared.result(lavaBuoyancySnapshot),
    BlocksPerSecondSquared.result(lavaFlowAccelerationSnapshot),
  ])

  return Result.flatMap(inputs, ([secondsValue, vx, vy, vz, waterDrag, waterDragY, waterBuoyancy, waterFlowAcceleration, lavaDrag, lavaDragY, lavaBuoyancy, lavaFlowAcceleration]) => {
    const seconds = nonNegativeFinite(secondsValue)
    const waterVolume = volume(effects.waterVolume)
    const lavaVolume = volume(effects.lavaVolume)
    const dragPerSecond = waterVolume * nonNegativeFinite(waterDrag) + lavaVolume * nonNegativeFinite(lavaDrag)
    const dragPerSecondY = waterVolume * nonNegativeFinite(waterDragY) + lavaVolume * nonNegativeFinite(lavaDragY)
    const buoyancyAcceleration = waterVolume * nonNegativeFinite(waterBuoyancy) + lavaVolume * nonNegativeFinite(lavaBuoyancy)
    const flowAcceleration = waterVolume * nonNegativeFinite(waterFlowAcceleration) + lavaVolume * nonNegativeFinite(lavaFlowAcceleration)
    const dragMultiplier = Math.exp(-dragPerSecond * seconds)
    const dragMultiplierY = Math.exp(-dragPerSecondY * seconds)
    const flowX = finiteOrZero(effects.flow.x)
    const flowY = finiteOrZero(effects.flow.y)
    const flowZ = finiteOrZero(effects.flow.z)

    return Result.map(
      Result.all([
        BlocksPerSecond.result(vx * dragMultiplier + flowX * flowAcceleration * seconds),
        BlocksPerSecond.result(vy * dragMultiplierY + buoyancyAcceleration * seconds + flowY * flowAcceleration * seconds),
        BlocksPerSecond.result(vz * dragMultiplier + flowZ * flowAcceleration * seconds),
      ]),
      ([nextVx, nextVy, nextVz]): Body => ({ ...body, vx: nextVx, vy: nextVy, vz: nextVz }),
    )
  })
}
