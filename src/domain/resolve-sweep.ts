import {
  type AABB,
  CONTACT_EPSILON,
  CentreY,
  blockAABB,
  collidesWith,
} from './coordinates'
import { blockShapesAt, boxAt } from './resolve-shapes'
import type { Body } from './integrate'
import type { ResolveOptions } from './resolve-types'

type SweepAxis = 'x' | 'y' | 'z'

type SweepHit = {
  readonly time: number
  readonly axis: SweepAxis
}

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

const axisPriority = (axis: SweepAxis): number => AXIS_ORDER.indexOf(axis)

const forEachSweptCandidate = (
  start: Body,
  end: Body,
  options: ResolveOptions,
  visit: (block: AABB) => void,
): void => {
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
            for (const shape of blockShapesAt(options, bx, by, bz)) {
              visit(blockAABB(bx, by, bz, shape))
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

const sweptHit = (start: Body, end: Body, options: ResolveOptions): SweepHit | null => {
  const delta = { dx: end.x - start.x, dy: end.y - start.y, dz: end.z - start.z }
  const startBox = boxAt(options, start.x, start.y, start.z)
  const endBox = boxAt(options, end.x, end.y, end.z)
  let nearestTime = 0
  let nearestAxis: SweepAxis = 'y'
  let hasNearest = false

  forEachSweptCandidate(start, end, options, (block) => {
    const touchesVerticalFace =
      Math.abs(startBox.minY - block.maxY) <= CONTACT_EPSILON
      || Math.abs(startBox.maxY - block.minY) <= CONTACT_EPSILON
    if (Math.abs(delta.dy) <= CONTACT_EPSILON && touchesVerticalFace) {
      return
    }
    if (collidesWith(endBox, block)) {
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

  if (!hasNearest) {
    return null
  }
  return { axis: nearestAxis, time: nearestTime }
}

export const DIAMETER_FACTOR = 1 + 1
const MAX_SWEEP_COLLISIONS_PER_STEP = 3

export const resolveSweptMotion = (start: Body, integrated: Body, options: ResolveOptions): Body => {
  const minimumBodySpan = Math.min(
    DIAMETER_FACTOR * options.halfWidth,
    DIAMETER_FACTOR * Number(options.halfHeight),
  )
  if (
    Math.abs(integrated.x - start.x) <= minimumBodySpan
    && Math.abs(integrated.y - start.y) <= minimumBodySpan
    && Math.abs(integrated.z - start.z) <= minimumBodySpan
  ) {
    return integrated
  }

  let from = start
  let target = integrated
  for (let collision = 0; collision < MAX_SWEEP_COLLISIONS_PER_STEP; collision += 1) {
    const hit = sweptHit(from, target, options)
    if (hit === null) {
      break
    }

    const dx = target.x - from.x
    const dy = target.y - from.y
    const dz = target.z - from.z
    const contact: Body = {
      ...target,
      x: from.x + dx * hit.time,
      y: CentreY(from.y + dy * hit.time),
      z: from.z + dz * hit.time,
    }
    if (hit.axis === 'x') {
      target = { ...target, vx: 0, x: contact.x }
    } else if (hit.axis === 'y') {
      target = { ...target, vy: 0, y: contact.y }
    } else {
      target = { ...target, vz: 0, z: contact.z }
    }
    from = contact
  }

  return target
}
