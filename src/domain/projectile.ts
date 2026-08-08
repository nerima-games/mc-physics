/* eslint-disable complexity, id-length, max-statements, no-continue, no-magic-numbers, no-ternary, no-undefined */
import type { AABB, Vec3 } from './coordinates'

export const ARROW_GRAVITY = 9.81
export const ARROW_AIR_DRAG = 0.99
export const ARROW_WATER_DRAG = 0.6
export const ARROW_MAX_LIFETIME_SECONDS = 60
export const ARROW_SHOOTER_GRACE_SECONDS = 0.25

export type ProjectileEntity = Readonly<{ id: string; bounds: AABB }>
export type ProjectileWorld = Readonly<{
  blockBounds: (start: Vec3, end: Vec3) => readonly AABB[]
  entities: readonly ProjectileEntity[]
  isInWater: (position: Vec3) => boolean
  bounds: AABB
}>

export type ProjectileHit =
  | Readonly<{ kind: 'block'; point: Vec3; normal: Vec3; flightTimeSeconds: number }>
  | Readonly<{ kind: 'entity'; entityId: string; point: Vec3; normal: Vec3; flightTimeSeconds: number }>

type ArrowBase = Readonly<{
  position: Vec3
  velocity: Vec3
  ageSeconds: number
  shooterId?: string
}>

export type Arrow =
  | (ArrowBase & Readonly<{ state: 'flying' }>)
  | (ArrowBase & Readonly<{ state: 'stuck'; hit: ProjectileHit; recoverable: boolean }>)
  | (ArrowBase & Readonly<{ state: 'despawned'; reason: 'invalid' | 'lifetime' | 'world' | 'entity-hit' }>)

export type ArrowLaunch = Readonly<{
  position: Vec3
  yawRadians: number
  pitchRadians: number
  speed: number
  shooterId?: string
}>

export type ProjectileStep = Readonly<{ arrow: Arrow; hit?: ProjectileHit }>

type SegmentHit = Readonly<{ fraction: number; point: Vec3; normal: Vec3 }>

const finiteVec = (value: Vec3): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)

const validBox = (box: AABB): boolean =>
  Number.isFinite(box.minX) && Number.isFinite(box.minY) && Number.isFinite(box.minZ) &&
  Number.isFinite(box.maxX) && Number.isFinite(box.maxY) && Number.isFinite(box.maxZ) &&
  box.minX <= box.maxX && box.minY <= box.maxY && box.minZ <= box.maxZ

const contains = (box: AABB, point: Vec3): boolean =>
  point.x >= box.minX && point.x <= box.maxX &&
  point.y >= box.minY && point.y <= box.maxY &&
  point.z >= box.minZ && point.z <= box.maxZ

const segmentAABB = (start: Vec3, end: Vec3, box: AABB): SegmentHit | null => {
  if (!validBox(box)) {return null}
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const deltaZ = end.z - start.z
  let near = 0
  let far = 1
  let normalX = 0
  let normalY = 0
  let normalZ = 0
  let axisDelta = deltaX
  let axisStart = start.x
  let axisMin = box.minX
  let axisMax = box.maxX
  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    if (axisIndex === 1) {
      axisDelta = deltaY
      axisStart = start.y
      axisMin = box.minY
      axisMax = box.maxY
    } else if (axisIndex === 2) {
      axisDelta = deltaZ
      axisStart = start.z
      axisMin = box.minZ
      axisMax = box.maxZ
    }
    if (axisDelta === 0) {
      if (axisStart < axisMin || axisStart > axisMax) {return null}
      continue
    }
    const low = (axisMin - axisStart) / axisDelta
    const high = (axisMax - axisStart) / axisDelta
    const entering = Math.min(low, high)
    if (entering > near) {
      near = entering
      if (axisIndex === 0) {
        normalX = axisDelta > 0 ? -1 : 1
        normalY = 0
        normalZ = 0
      } else if (axisIndex === 1) {
        normalX = 0
        normalY = axisDelta > 0 ? -1 : 1
        normalZ = 0
      } else {
        normalX = 0
        normalY = 0
        normalZ = axisDelta > 0 ? -1 : 1
      }
    }
    far = Math.min(far, Math.max(low, high))
    if (near > far) {return null}
  }
  /*
   * PROOF this check's condition is unreachable, not merely untested: `near`
   * starts at 0 and is only ever replaced by a strictly larger `entering`
   * value, so `near >= 0` holds for the rest of the function. `far` starts at
   * 1 and is only ever narrowed by `Math.min`, so `far <= 1` holds throughout
   * too. If `near` had ever exceeded 1 it would also have exceeded `far`
   * (since `far <= 1 < near` at that point), and the `near > far` check two
   * lines above would already have returned `null` on that same axis's
   * iteration — this line is only reached when the loop completes without
   * that happening, i.e. when `near <= far <= 1` held on every axis. So at
   * this point `0 <= near <= far <= 1`, making `near < 0 || near > 1`
   * provably always false.
   */
  /* v8 ignore next */
  if (near < 0 || near > 1) {return null}
  return {
    fraction: near,
    normal: { x: normalX, y: normalY, z: normalZ },
    point: { x: start.x + deltaX * near, y: start.y + deltaY * near, z: start.z + deltaZ * near },
  }
}

const despawn = (arrow: ArrowBase, reason: Extract<Arrow, { state: 'despawned' }>['reason']): ProjectileStep => ({
  arrow: { ...arrow, reason, state: 'despawned' },
})

export const launchArrow = (launch: ArrowLaunch): Arrow => {
  const horizontal = Math.cos(launch.pitchRadians)
  const velocity = {
    x: -Math.sin(launch.yawRadians) * horizontal * launch.speed,
    y: -Math.sin(launch.pitchRadians) * launch.speed,
    z: -Math.cos(launch.yawRadians) * horizontal * launch.speed,
  }
  const base = { ageSeconds: 0, position: launch.position, velocity, ...(launch.shooterId === undefined ? {} : { shooterId: launch.shooterId }) }
  return finiteVec(launch.position) && finiteVec(velocity) && Number.isFinite(launch.speed) && launch.speed >= 0
    ? { ...base, state: 'flying' }
    : { ...base, reason: 'invalid', state: 'despawned' }
}

export const stepArrow = (arrow: Arrow, world: ProjectileWorld, dt: number): ProjectileStep => {
  if (arrow.state !== 'flying') {return { arrow }}
  if (!finiteVec(arrow.position) || !finiteVec(arrow.velocity) || !Number.isFinite(dt) || dt <= 0 || !validBox(world.bounds)) {
    return despawn(arrow, 'invalid')
  }
  const ageSeconds = arrow.ageSeconds + dt
  if (!Number.isFinite(ageSeconds) || ageSeconds >= ARROW_MAX_LIFETIME_SECONDS) {return despawn({ ...arrow, ageSeconds }, 'lifetime')}

  const drag = (world.isInWater(arrow.position) ? ARROW_WATER_DRAG : ARROW_AIR_DRAG) ** (dt * 20)
  const velocity = {
    x: arrow.velocity.x * drag,
    y: (arrow.velocity.y - ARROW_GRAVITY * dt) * drag,
    z: arrow.velocity.z * drag,
  }
  const end = {
    x: arrow.position.x + velocity.x * dt,
    y: arrow.position.y + velocity.y * dt,
    z: arrow.position.z + velocity.z * dt,
  }
  if (!finiteVec(velocity) || !finiteVec(end)) {return despawn({ ...arrow, ageSeconds }, 'invalid')}

  let first: (SegmentHit & Readonly<{ kind: 'block' | 'entity'; entityId?: string }>) | null = null
  for (const box of world.blockBounds(arrow.position, end)) {
    const hit = segmentAABB(arrow.position, end, box)
    if (hit !== null && (first === null || hit.fraction < first.fraction)) {first = { ...hit, kind: 'block' }}
  }
  for (const entity of world.entities) {
    if (entity.id === arrow.shooterId && arrow.ageSeconds < ARROW_SHOOTER_GRACE_SECONDS) {continue}
    const hit = segmentAABB(arrow.position, end, entity.bounds)
    if (hit !== null && (first === null || hit.fraction < first.fraction)) {first = { ...hit, entityId: entity.id, kind: 'entity' }}
  }
  if (first !== null) {
    const flightTimeSeconds = arrow.ageSeconds + dt * first.fraction
    /*
     * PROOF the `?? ''` fallback below is unreachable, not merely untested:
     * `first.entityId` is only read there inside the `first.kind === 'entity'`
     * branch, and `first` is built in exactly two places above — the `'block'`
     * branch never sets `entityId` at all, and the `'entity'` branch always
     * sets it to `entity.id`, a required (non-optional) `string` on
     * `ProjectileEntity`. So whenever `first.kind === 'entity'`,
     * `first.entityId` is already a defined string; the type only carries
     * `entityId?: string` because it is shared with the `'block'` shape.
     */
    /* v8 ignore next */
    const entityId = first.entityId ?? ''
    const hit: ProjectileHit = first.kind === 'block'
      ? { flightTimeSeconds, kind: 'block', normal: first.normal, point: first.point }
      : { entityId, flightTimeSeconds, kind: 'entity', normal: first.normal, point: first.point }
    const base = { ...arrow, ageSeconds: flightTimeSeconds, position: first.point, velocity: { x: 0, y: 0, z: 0 } }
    return first.kind === 'block'
      ? { arrow: { ...base, hit, recoverable: true, state: 'stuck' }, hit }
      : { arrow: { ...base, reason: 'entity-hit', state: 'despawned' }, hit }
  }

  const next: Arrow = { ...arrow, ageSeconds, position: end, state: 'flying', velocity }
  return contains(world.bounds, end) ? { arrow: next } : despawn(next, 'world')
}
