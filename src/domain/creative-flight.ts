import { type Brand, Result } from 'effect'
import { BlocksPerSecond } from './physical-units.js'
import type { Body } from './integrate.js'

export type CreativeFlightState = Readonly<{
  readonly enabled: boolean
}>

export type CreativeFlightInput = Readonly<{
  readonly ascend: boolean
  readonly descend: boolean
}>

export const createCreativeFlightState = (): CreativeFlightState => ({ enabled: false })

export const toggleCreativeFlight = (
  state: CreativeFlightState,
  canFly: boolean,
  togglePressed: boolean,
): CreativeFlightState => {
  if (!canFly) {
    if (state.enabled) {
      return { enabled: false }
    }
    return state
  }
  if (!togglePressed) {
    return state
  }
  return { enabled: !state.enabled }
}

export const applyCreativeFlightInput = (
  body: Body,
  state: CreativeFlightState,
  input: CreativeFlightInput,
  verticalSpeed: BlocksPerSecond,
): Result.Result<Body, Brand.BrandError> => {
  if (!state.enabled || body.kind !== 'dynamic') {
    return Result.succeed(body)
  }

  const vxSnapshot = body.vx
  const vySnapshot = body.vy
  const vzSnapshot = body.vz
  const verticalSpeedSnapshot = verticalSpeed
  const checked = Result.all([
    BlocksPerSecond.result(vxSnapshot),
    BlocksPerSecond.result(vySnapshot),
    BlocksPerSecond.result(vzSnapshot),
    BlocksPerSecond.result(verticalSpeedSnapshot),
  ])
  if (Result.isFailure(checked)) {
    return Result.fail(checked.failure)
  }

  const [vx, , vz, configuredSpeed] = checked.success
  const speed = Math.max(0, configuredSpeed)
  let nextVy = 0
  if (input.ascend !== input.descend) {
    if (input.ascend) {
      nextVy = speed
    } else {
      nextVy = -speed
    }
  }
  const checkedNextVy = BlocksPerSecond.result(nextVy)
  return Result.map(checkedNextVy, (vy) => ({ ...body, vx, vy, vz }))
}
