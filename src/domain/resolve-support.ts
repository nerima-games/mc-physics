import {
  type AABB,
  CONTACT_EPSILON,
  CentreY,
  isRestingOn,
} from './coordinates.js'
import { type AxisState, clampAxis } from './resolve-axis.js'
import { BlockAxis, PositionAxis } from '@nerima-games/mc-kernel'
import { BlockLength, BlocksPerSecond } from './physical-units.js'
import type { ResolveError, ResolveOptions } from './resolve-types.js'
import { blockShapesAtAxes, boxAt, forEachCollidingBlock } from './resolve-shapes.js'
import type { Body } from './integrate.js'
import { Result } from 'effect'

export const isSupported = (options: ResolveOptions, box: AABB): Result.Result<boolean, ResolveError> => {
  const feetCell = Math.floor(box.minY)
  const bounds = Result.all([
    BlockAxis.result(Math.floor(box.minX)),
    BlockAxis.result(Math.floor(box.maxX)),
    BlockAxis.result(feetCell - 1),
    BlockAxis.result(feetCell),
    BlockAxis.result(Math.floor(box.minZ)),
    BlockAxis.result(Math.floor(box.maxZ)),
  ])
  if (Result.isFailure(bounds)) {
    return Result.fail(bounds.failure)
  }
  const [minX, maxX, minY, maxY, minZ, maxZ] = bounds.success

  for (let bx = Number(minX); bx <= maxX; bx += 1) {
    for (let bz = Number(minZ); bz <= maxZ; bz += 1) {
      for (let by = Number(minY); by <= maxY; by += 1) {
        const shapes = blockShapesAtAxes(options, BlockAxis(bx), BlockAxis(by), BlockAxis(bz))
        if (Result.isFailure(shapes)) {
          return Result.fail(shapes.failure)
        }
        for (const block of shapes.success) {
          if (isRestingOn(box, block)) {
            return Result.succeed(true)
          }
        }
      }
    }
  }

  return Result.succeed(false)
}

const highestStepSupport = (
  options: ResolveOptions,
  horizontalBox: AABB,
  feetY: PositionAxis,
  stepHeight: BlockLength,
): Result.Result<PositionAxis | null, ResolveError> => {
  const minimumTop = PositionAxis.result(feetY - CONTACT_EPSILON)
  const maximumTop = PositionAxis.result(feetY + stepHeight + CONTACT_EPSILON)
  const probeY = Result.all([minimumTop, maximumTop])
  return Result.flatMap(probeY, ([minY, maxY]) => {
    const probe: AABB = {
      maxX: horizontalBox.maxX,
      maxY,
      maxZ: horizontalBox.maxZ,
      minX: horizontalBox.minX,
      minY,
      minZ: horizontalBox.minZ,
    }
    let top: PositionAxis | null = null
    const visited = forEachCollidingBlock(options, probe, (block) => {
      if (block.maxY < minY || block.maxY > maxY) {
        return
      }
      if (top === null || block.maxY > top) {
        top = block.maxY
      }
    })
    if (Result.isFailure(visited)) {
      return Result.fail(visited.failure)
    }
    return Result.succeed(top)
  })
}

export const tryStepUp = (
  body: Body,
  resolvedY: CentreY,
  alongX: AxisState<PositionAxis>,
  alongZ: AxisState<PositionAxis>,
  verticalVelocity: BlocksPerSecond,
  options: ResolveOptions,
): Result.Result<Body | null, ResolveError> => {
  const stepHeightSnapshot = options.stepHeight ?? BlockLength(0)
  const checkedStepHeight = BlockLength.result(stepHeightSnapshot)
  const checkedVelocity = BlocksPerSecond.result(verticalVelocity)
  if (Result.isFailure(checkedStepHeight)) {
    return Result.fail(checkedStepHeight.failure)
  }
  if (Result.isFailure(checkedVelocity)) {
    return Result.fail(checkedVelocity.failure)
  }
  const stepHeight = checkedStepHeight.success
  if (stepHeight < 0) {
    return Result.fail(new RangeError('stepHeight must be non-negative'))
  }
  if (stepHeight <= 0 || checkedVelocity.success > 0 || (!alongX.blocked && !alongZ.blocked)) {
    return Result.succeed(null)
  }

  const raisedY = CentreY.result(Number(resolvedY) + stepHeight)
  if (Result.isFailure(raisedY)) {
    return Result.fail(raisedY.failure)
  }
  const raisedBox = boxAt(options, body.x, raisedY.success, body.z)
  if (Result.isFailure(raisedBox)) {
    return Result.fail(raisedBox.failure)
  }
  const raisedX = clampAxis(
    { blocked: false, position: body.x, velocity: body.vx },
    raisedBox.success.minX,
    raisedBox.success.maxX,
    options.halfWidth,
    options,
    raisedBox.success,
    {
      farFace: (block) => block.maxX,
      nearFace: (block) => block.minX,
      positionResult: PositionAxis.result,
    },
  )
  if (Result.isFailure(raisedX)) {
    return Result.fail(raisedX.failure)
  }
  const raisedAfterX = boxAt(options, raisedX.success.position, raisedY.success, body.z)
  if (Result.isFailure(raisedAfterX)) {
    return Result.fail(raisedAfterX.failure)
  }
  const raisedZ = clampAxis(
    { blocked: false, position: body.z, velocity: body.vz },
    raisedAfterX.success.minZ,
    raisedAfterX.success.maxZ,
    options.halfWidth,
    options,
    raisedAfterX.success,
    {
      farFace: (block) => block.maxZ,
      nearFace: (block) => block.minZ,
      positionResult: PositionAxis.result,
    },
  )
  if (Result.isFailure(raisedZ)) {
    return Result.fail(raisedZ.failure)
  }
  if (raisedX.success.blocked || raisedZ.success.blocked) {
    return Result.succeed(null)
  }

  const horizontalBox = boxAt(options, raisedX.success.position, resolvedY, raisedZ.success.position)
  if (Result.isFailure(horizontalBox)) {
    return Result.fail(horizontalBox.failure)
  }
  const supportTop = highestStepSupport(options, horizontalBox.success, horizontalBox.success.minY, stepHeight)
  if (Result.isFailure(supportTop)) {
    return Result.fail(supportTop.failure)
  }
  if (supportTop.success === null) {
    return Result.succeed(null)
  }

  return Result.map(CentreY.result(supportTop.success + options.halfHeight), (y): Body => ({
    kind: 'dynamic',
    vx: raisedX.success.velocity,
    vy: checkedVelocity.success,
    vz: raisedZ.success.velocity,
    x: raisedX.success.position,
    y,
    z: raisedZ.success.position,
  }))
}
