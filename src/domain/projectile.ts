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
  [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ].every(Number.isFinite) &&
  box.minX <= box.maxX && box.minY <= box.maxY && box.minZ <= box.maxZ

const contains = (box: AABB, point: Vec3): boolean =>
  point.x >= box.minX && point.x <= box.maxX &&
  point.y >= box.minY && point.y <= box.maxY &&
  point.z >= box.minZ && point.z <= box.maxZ

const segmentAABB = (start: Vec3, end: Vec3, box: AABB): SegmentHit | null => {
  if (!validBox(box)) {return null}
  const delta = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }
  let near = 0
  let far = 1
  let normal: Vec3 = { x: 0, y: 0, z: 0 }
  const axes = [
    { delta: delta.x, high: { x: 1, y: 0, z: 0 }, low: { x: -1, y: 0, z: 0 }, max: box.maxX, min: box.minX, start: start.x },
    { delta: delta.y, high: { x: 0, y: 1, z: 0 }, low: { x: 0, y: -1, z: 0 }, max: box.maxY, min: box.minY, start: start.y },
    { delta: delta.z, high: { x: 0, y: 0, z: 1 }, low: { x: 0, y: 0, z: -1 }, max: box.maxZ, min: box.minZ, start: start.z },
  ] as const
  for (const axis of axes) {
    if (axis.delta === 0) {
      if (axis.start < axis.min || axis.start > axis.max) {return null}
      continue
    }
    const low = (axis.min - axis.start) / axis.delta
    const high = (axis.max - axis.start) / axis.delta
    const entering = Math.min(low, high)
    if (entering > near) {
      near = entering
      normal = axis.delta > 0 ? axis.low : axis.high
    }
    far = Math.min(far, Math.max(low, high))
    if (near > far) {return null}
  }
  if (near < 0 || near > 1) {return null}
  return {
    fraction: near,
    normal,
    point: { x: start.x + delta.x * near, y: start.y + delta.y * near, z: start.z + delta.z * near },
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
    const hit: ProjectileHit = first.kind === 'block'
      ? { flightTimeSeconds, kind: 'block', normal: first.normal, point: first.point }
      : { entityId: first.entityId ?? '', flightTimeSeconds, kind: 'entity', normal: first.normal, point: first.point }
    const base = { ...arrow, ageSeconds: flightTimeSeconds, position: first.point, velocity: { x: 0, y: 0, z: 0 } }
    return first.kind === 'block'
      ? { arrow: { ...base, hit, recoverable: true, state: 'stuck' }, hit }
      : { arrow: { ...base, reason: 'entity-hit', state: 'despawned' }, hit }
  }

  const next: Arrow = { ...arrow, ageSeconds, position: end, state: 'flying', velocity }
  return contains(world.bounds, end) ? { arrow: next } : despawn(next, 'world')
}
