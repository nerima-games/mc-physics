import { type Body, type IntegrationOptions, integrateBody } from './integrate.js'
import { DIAMETER_FACTOR, resolveSweptMotion } from './resolve-sweep.js'
import type {
  HasGroundSupport,
  HorizontalPosition,
  Resolution,
  ResolveOptions,
} from './resolve-types.js'
import { clampAxis, resolveVertical } from './resolve-axis.js'
import { isSupported, tryStepUp } from './resolve-support.js'
import { CentreY } from './coordinates.js'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { boxAt } from './resolve-shapes.js'

export type {
  BlockPropertiesAt,
  BlockShapeAt,
  HasGroundSupport,
  HorizontalPosition,
  Resolution,
  ResolveOptions,
} from './resolve-types.js'

export const clampSneakEdge = (
  previous: HorizontalPosition,
  next: HorizontalPosition,
  hasGroundSupport: HasGroundSupport,
): HorizontalPosition => {
  let nextX = next.x
  let nextZ = next.z

  if (next.x !== previous.x && !hasGroundSupport(next.x, previous.z)) {
    nextX = previous.x
  }
  if (next.z !== previous.z && !hasGroundSupport(previous.x, next.z)) {
    nextZ = previous.z
  }

  return { x: nextX, z: nextZ }
}

export const resolveBody = (body: Body, deltaTime: DeltaTimeSecs, options: ResolveOptions): Resolution => {
  if (body.kind !== 'dynamic') {
    return { body, isGrounded: isSupported(options, boxAt(options, body.x, body.y, body.z)) }
  }

  const vertical = resolveVertical(
    options,
    boxAt(options, body.x, body.y, body.z),
    { blocked: false, position: body.y, velocity: body.vy },
    deltaTime,
  )
  const resolvedY = CentreY(vertical.position)
  const boxAfterY = boxAt(options, body.x, resolvedY, body.z)
  const alongX = clampAxis(
    { blocked: false, position: body.x, velocity: body.vx },
    boxAfterY.minX,
    boxAfterY.maxX,
    options.halfWidth,
    options,
    boxAfterY,
    (block) => block.minX,
    (block) => block.maxX,
  )
  const boxAfterX = boxAt(options, alongX.position, resolvedY, body.z)
  const alongZ = clampAxis(
    { blocked: false, position: body.z, velocity: body.vz },
    boxAfterX.minZ,
    boxAfterX.maxZ,
    options.halfWidth,
    options,
    boxAfterX,
    (block) => block.minZ,
    (block) => block.maxZ,
  )
  const stepped = tryStepUp(body, resolvedY, alongX, alongZ, vertical.velocity, options)
  if (stepped !== null) {
    return {
      body: stepped,
      isGrounded: isSupported(options, boxAt(options, stepped.x, stepped.y, stepped.z)),
    }
  }

  const resolved: Body = {
    kind: 'dynamic',
    vx: alongX.velocity,
    vy: vertical.velocity,
    vz: alongZ.velocity,
    x: alongX.position,
    y: resolvedY,
    z: alongZ.position,
  }

  /*
   * A bounced body sits exactly where it landed this frame, which
   * `isSupported` (a purely positional check) would read as resting — but its
   * velocity now points away from the surface, so it is not grounded.
   */
  let isGrounded = false
  if (vertical.bounced !== true) {
    isGrounded = isSupported(options, boxAt(options, resolved.x, resolved.y, resolved.z))
  }

  return {
    body: resolved,
    isGrounded,
  }
}

export const resolveWorld = (
  bodies: ReadonlyArray<Body>,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
): ReadonlyArray<Resolution> => bodies.map((body) => resolveBody(body, deltaTime, options))

export const stepBody = (
  body: Body,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
  integration: IntegrationOptions = {},
): Resolution => {
  const integrated = integrateBody(body, deltaTime, integration)
  let collisionSafe = integrated
  if (body.kind === 'dynamic') {
    collisionSafe = resolveSweptMotion(body, integrated, options)
  }
  return resolveBody(collisionSafe, deltaTime, options)
}

export const stepWorld = (
  bodies: ReadonlyArray<Body>,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
  integration: IntegrationOptions = {},
): ReadonlyArray<Resolution> => bodies.map((body) => stepBody(body, deltaTime, options, integration))

export const maxSpeedWithoutTunnelling = (halfExtent: number, blockThickness: number, maxDeltaSecs: number): number =>
  (blockThickness + DIAMETER_FACTOR * halfExtent) / maxDeltaSecs
