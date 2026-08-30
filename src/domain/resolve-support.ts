import {
  type AABB,
  CONTACT_EPSILON,
  CentreY,
  blockAABB,
  isRestingOn,
} from './coordinates.js'
import { type AxisState, clampAxis } from './resolve-axis.js'
import { blockShapesAt, boxAt, forEachCollidingBlock } from './resolve-shapes.js'
import type { Body } from './integrate.js'
import type { ResolveOptions } from './resolve-types.js'

export const isSupported = (options: ResolveOptions, box: AABB): boolean => {
  const feetCell = Math.floor(box.minY)
  const bxMax = Math.floor(box.maxX)
  const bzMax = Math.floor(box.maxZ)

  for (let bx = Math.floor(box.minX); bx <= bxMax; bx += 1) {
    for (let bz = Math.floor(box.minZ); bz <= bzMax; bz += 1) {
      for (let by = feetCell - 1; by <= feetCell; by += 1) {
        for (const shape of blockShapesAt(options, bx, by, bz)) {
          if (isRestingOn(box, blockAABB(bx, by, bz, shape))) {
            return true
          }
        }
      }
    }
  }

  return false
}

const highestStepSupport = (
  options: ResolveOptions,
  horizontalBox: AABB,
  feetY: number,
  stepHeight: number,
): number | null => {
  const minimumTop = feetY - CONTACT_EPSILON
  const maximumTop = feetY + stepHeight + CONTACT_EPSILON
  const probe: AABB = {
    maxX: horizontalBox.maxX,
    maxY: maximumTop,
    maxZ: horizontalBox.maxZ,
    minX: horizontalBox.minX,
    minY: minimumTop,
    minZ: horizontalBox.minZ,
  }
  let top: number | null = null
  forEachCollidingBlock(options, probe, (block) => {
    if (block.maxY < minimumTop || block.maxY > maximumTop) {
      return
    }
    if (top === null || block.maxY > top) {
      top = block.maxY
    }
  })
  return top
}

export const tryStepUp = (
  body: Body,
  resolvedY: CentreY,
  alongX: AxisState,
  alongZ: AxisState,
  verticalVelocity: number,
  options: ResolveOptions,
): Body | null => {
  const stepHeight = options.stepHeight ?? 0
  if (stepHeight <= 0 || verticalVelocity > 0 || (!alongX.blocked && !alongZ.blocked)) {
    return null
  }

  const raisedY = CentreY(Number(resolvedY) + stepHeight)
  const raisedBox = boxAt(options, body.x, raisedY, body.z)
  const raisedX = clampAxis(
    { blocked: false, position: body.x, velocity: body.vx },
    raisedBox.minX,
    raisedBox.maxX,
    options.halfWidth,
    options,
    raisedBox,
    (block) => block.minX,
    (block) => block.maxX,
  )
  const raisedAfterX = boxAt(options, raisedX.position, raisedY, body.z)
  const raisedZ = clampAxis(
    { blocked: false, position: body.z, velocity: body.vz },
    raisedAfterX.minZ,
    raisedAfterX.maxZ,
    options.halfWidth,
    options,
    raisedAfterX,
    (block) => block.minZ,
    (block) => block.maxZ,
  )
  if (raisedX.blocked || raisedZ.blocked) {
    return null
  }

  const horizontalBox = boxAt(options, raisedX.position, resolvedY, raisedZ.position)
  const supportTop = highestStepSupport(options, horizontalBox, horizontalBox.minY, stepHeight)
  if (supportTop === null) {
    return null
  }

  return {
    kind: 'dynamic',
    vx: raisedX.velocity,
    vy: verticalVelocity,
    vz: raisedZ.velocity,
    x: raisedX.position,
    y: CentreY(supportTop + options.halfHeight),
    z: raisedZ.position,
  }
}
