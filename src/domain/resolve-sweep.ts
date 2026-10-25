import {
  type AABB,
  CONTACT_EPSILON,
  CentreY,
  HalfHeight,
  collidesWith,
} from './coordinates.js'
import { BlockLength, BlocksPerSecond } from './physical-units.js'
import type { ResolveError, ResolveOptions } from './resolve-types.js'
import { blockShapesAt, boxAt } from './resolve-shapes.js'
import type { Body } from './integrate.js'
import { PositionAxis } from '@nerima-games/mc-kernel'
import { Result } from 'effect'

type SweepAxis = 'x' | 'y' | 'z'

type SweepHit = {
  readonly time: number
  readonly axis: SweepAxis
}

type SweepMotion = Readonly<{ readonly from: Body; readonly target: Body; readonly done: boolean }>

type Vec3Delta = {
  readonly dx: number
  readonly dy: number
  readonly dz: number
}

type ExpandedBlockBounds = {
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  readonly minX: number
  readonly minY: number
  readonly minZ: number
}

type SweepAxisComponents = {
  readonly axis: SweepAxis
  readonly delta: number
  readonly max: number
  readonly min: number
  readonly origin: number
}

const AXIS_ORDER: ReadonlyArray<SweepAxis> = ['y', 'x', 'z']
const ZERO_VELOCITY = BlocksPerSecond(0)

const axisPriority = (axis: SweepAxis): number => AXIS_ORDER.indexOf(axis)

const forEachSweptCandidate = (
  start: Body,
  end: Body,
  options: ResolveOptions,
  visit: (block: AABB) => void,
): Result.Result<void, ResolveError> => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  const crossings = Math.abs(Math.floor(end.x) - Math.floor(start.x))
    + Math.abs(Math.floor(end.y) - Math.floor(start.y))
    + Math.abs(Math.floor(end.z) - Math.floor(start.z))
  const steps = Math.max(1, crossings + 1)
  const radiusX = Math.ceil(options.halfWidth)
  const radiusY = Math.ceil(Number(options.halfHeight))
  let hasPreviousRange = false
  let previousMinX = 0
  let previousMaxX = 0
  let previousMinY = 0
  let previousMaxY = 0
  let previousMinZ = 0
  let previousMaxZ = 0

  for (let index = 0; index <= steps; index += 1) {
    const time = index / steps
    const cx = Math.floor(start.x + dx * time)
    const cy = Math.floor(start.y + dy * time)
    const cz = Math.floor(start.z + dz * time)
    const minX = cx - radiusX
    const maxX = cx + radiusX
    const minY = cy - radiusY
    const maxY = cy + radiusY
    const minZ = cz - radiusX
    const maxZ = cz + radiusX

    for (let bx = minX; bx <= maxX; bx += 1) {
      for (let by = minY; by <= maxY; by += 1) {
        for (let bz = minZ; bz <= maxZ; bz += 1) {
          const duplicate = hasPreviousRange
            && bx >= previousMinX && bx <= previousMaxX
            && by >= previousMinY && by <= previousMaxY
            && bz >= previousMinZ && bz <= previousMaxZ
          if (!duplicate) {
            const shapes = blockShapesAt(options, bx, by, bz)
            if (Result.isFailure(shapes)) {
              return Result.fail(shapes.failure)
            }
            for (const block of shapes.success) {
              visit(block)
            }
          }
        }
      }
    }

    hasPreviousRange = true
    previousMinX = minX
    previousMaxX = maxX
    previousMinY = minY
    previousMaxY = maxY
    previousMinZ = minZ
    previousMaxZ = maxZ
  }
  return Result.succeed(globalThis.undefined)
}

const sweepAxisComponents = (
  start: Body,
  delta: Vec3Delta,
  bounds: ExpandedBlockBounds,
): ReadonlyArray<SweepAxisComponents> => [
  { axis: 'y', delta: delta.dy, max: bounds.maxY, min: bounds.minY, origin: start.y },
  { axis: 'x', delta: delta.dx, max: bounds.maxX, min: bounds.minX, origin: start.x },
  { axis: 'z', delta: delta.dz, max: bounds.maxZ, min: bounds.minZ, origin: start.z },
]

const sweptHit = (start: Body, end: Body, options: ResolveOptions): Result.Result<SweepHit | null, ResolveError> => {
  const delta = { dx: end.x - start.x, dy: end.y - start.y, dz: end.z - start.z }
  const startBox = boxAt(options, start.x, start.y, start.z)
  const endBox = boxAt(options, end.x, end.y, end.z)
  if (Result.isFailure(startBox)) {
    return Result.fail(startBox.failure)
  }
  if (Result.isFailure(endBox)) {
    return Result.fail(endBox.failure)
  }
  let nearestTime = 0
  let nearestAxis: SweepAxis = 'y'
  let hasNearest = false

  const candidates = forEachSweptCandidate(start, end, options, (block) => {
    const touchesVerticalFace =
      Math.abs(startBox.success.minY - block.maxY) <= CONTACT_EPSILON
      || Math.abs(startBox.success.maxY - block.minY) <= CONTACT_EPSILON
    if (Math.abs(delta.dy) <= CONTACT_EPSILON && touchesVerticalFace) {
      return
    }
    if (collidesWith(endBox.success, block)) {
      return
    }

    const bounds: ExpandedBlockBounds = {
      maxX: block.maxX + options.halfWidth,
      maxY: block.maxY + Number(options.halfHeight),
      maxZ: block.maxZ + options.halfWidth,
      minX: block.minX - options.halfWidth,
      minY: block.minY - Number(options.halfHeight),
      minZ: block.minZ - options.halfWidth,
    }
    const strictlyInside =
      start.x > bounds.minX + CONTACT_EPSILON && start.x < bounds.maxX - CONTACT_EPSILON
      && start.y > bounds.minY + CONTACT_EPSILON && start.y < bounds.maxY - CONTACT_EPSILON
      && start.z > bounds.minZ + CONTACT_EPSILON && start.z < bounds.maxZ - CONTACT_EPSILON
    if (strictlyInside) {
      return
    }

    let entry = Number.NEGATIVE_INFINITY
    let exit = Number.POSITIVE_INFINITY
    let entryAxis: SweepAxis = 'y'
    let misses = false
    for (const component of sweepAxisComponents(start, delta, bounds)) {
      if (Math.abs(component.delta) <= CONTACT_EPSILON) {
        if (component.origin < component.min - CONTACT_EPSILON || component.origin > component.max + CONTACT_EPSILON) {
          misses = true
          break
        }
      } else {
        const first = (component.min - component.origin) / component.delta
        const second = (component.max - component.origin) / component.delta
        const axisEntry = Math.min(first, second)
        const axisExit = Math.max(first, second)
        if (axisEntry > entry + CONTACT_EPSILON) {
          entry = axisEntry
          entryAxis = component.axis
        }
        exit = Math.min(exit, axisExit)
      }
    }

    if (
      misses
      || entry > exit + CONTACT_EPSILON
      || exit < 0
      || entry < -CONTACT_EPSILON
      || entry >= 1 - CONTACT_EPSILON
    ) {
      return
    }

    const hitTime = Math.max(0, entry)
    if (
      !hasNearest
      || hitTime < nearestTime - CONTACT_EPSILON
      || (
        Math.abs(hitTime - nearestTime) <= CONTACT_EPSILON
        && axisPriority(entryAxis) < axisPriority(nearestAxis)
      )
    ) {
      nearestTime = hitTime
      nearestAxis = entryAxis
      hasNearest = true
    }
  })
  if (Result.isFailure(candidates)) {
    return Result.fail(candidates.failure)
  }
  if (!hasNearest) {
    return Result.succeed(null)
  }
  return Result.succeed({ axis: nearestAxis, time: nearestTime })
}

export const DIAMETER_FACTOR: number = 1 + 1
const MAX_SWEEP_COLLISIONS_PER_STEP = 3

const resolveSweptMotionChecked = (
  start: Body,
  integrated: Body,
  options: ResolveOptions,
): Result.Result<Body, ResolveError> => {
  const minimumBodySpan = Math.min(
    DIAMETER_FACTOR * options.halfWidth,
    DIAMETER_FACTOR * Number(options.halfHeight),
  )
  if (
    Math.abs(integrated.x - start.x) <= minimumBodySpan
    && Math.abs(integrated.y - start.y) <= minimumBodySpan
    && Math.abs(integrated.z - start.z) <= minimumBodySpan
  ) {
    return Result.succeed(integrated)
  }

  let motion: Result.Result<SweepMotion, ResolveError> =
    Result.succeed({ done: false, from: start, target: integrated })
  for (let collision = 0; collision < MAX_SWEEP_COLLISIONS_PER_STEP; collision += 1) {
    motion = Result.flatMap(motion, (current) => {
      if (current.done) {
        return Result.succeed(current)
      }
      return Result.flatMap(sweptHit(current.from, current.target, options), (hit): Result.Result<SweepMotion, ResolveError> => {
        if (hit === null) {
          const done: SweepMotion = { ...current, done: true }
          return Result.succeed(done)
        }
        const dx = current.target.x - current.from.x
        const dy = current.target.y - current.from.y
        const dz = current.target.z - current.from.z
        const contactPositions = Result.all([
          PositionAxis.result(current.from.x + dx * hit.time),
          CentreY.result(current.from.y + dy * hit.time),
          PositionAxis.result(current.from.z + dz * hit.time),
        ])
        return Result.map(contactPositions, ([contactX, contactY, contactZ]): SweepMotion => {
          const contact: Body = { ...current.target, x: contactX, y: contactY, z: contactZ }
          let { target } = current
          if (hit.axis === 'x') {
            target = { ...target, vx: ZERO_VELOCITY, x: contact.x }
          } else if (hit.axis === 'y') {
            target = { ...target, vy: ZERO_VELOCITY, y: contact.y }
          } else {
            target = { ...target, vz: ZERO_VELOCITY, z: contact.z }
          }
          return { done: false, from: contact, target }
        })
      })
    })
  }

  return Result.map(motion, (current) => current.target)
}

export const resolveSweptMotionFromValidated = (
  start: Body,
  integrated: Body,
  options: ResolveOptions,
): Result.Result<Body, ResolveError> => resolveSweptMotionChecked(start, integrated, options)

export const resolveSweptMotion = (
  start: Body,
  integrated: Body,
  options: ResolveOptions,
): Result.Result<Body, ResolveError> => {
  const checkedBodies = Result.all([
    PositionAxis.result(start.x),
    CentreY.result(start.y),
    PositionAxis.result(start.z),
    BlocksPerSecond.result(start.vx),
    BlocksPerSecond.result(start.vy),
    BlocksPerSecond.result(start.vz),
    PositionAxis.result(integrated.x),
    CentreY.result(integrated.y),
    PositionAxis.result(integrated.z),
    BlocksPerSecond.result(integrated.vx),
    BlocksPerSecond.result(integrated.vy),
    BlocksPerSecond.result(integrated.vz),
    BlockLength.result(options.halfWidth),
    HalfHeight.result(options.halfHeight),
  ])
  if (Result.isFailure(checkedBodies)) {
    return Result.fail(checkedBodies.failure)
  }
  const [
    startX,
    startY,
    startZ,
    startVx,
    startVy,
    startVz,
    integratedX,
    integratedY,
    integratedZ,
    integratedVx,
    integratedVy,
    integratedVz,
    halfWidth,
    halfHeight,
  ] = checkedBodies.success
  const checkedStart: Body = {
    ...start,
    vx: startVx,
    vy: startVy,
    vz: startVz,
    x: startX,
    y: startY,
    z: startZ,
  }
  const checkedIntegrated: Body = {
    ...integrated,
    vx: integratedVx,
    vy: integratedVy,
    vz: integratedVz,
    x: integratedX,
    y: integratedY,
    z: integratedZ,
  }
  const checkedOptions: ResolveOptions = { ...options, halfHeight, halfWidth }
  return resolveSweptMotionChecked(checkedStart, checkedIntegrated, checkedOptions)
}
