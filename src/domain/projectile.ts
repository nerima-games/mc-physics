/* eslint-disable complexity, id-length, max-statements, no-continue, no-magic-numbers, no-ternary, no-undefined */
import type { AABB } from './coordinates'
import type { Position } from '@nerima-games/mc-kernel'

/**
 * A launched projectile's tunable physical behaviour, on a seconds basis (not
 * Minecraft's per-tick basis) so it composes directly with the `dt` this
 * module already integrates on. `launchProjectile`/`stepProjectile` take one
 * of these instead of hard-coding arrow constants, so a snowball, egg, or
 * trident reuses the same swept-segment collision and lifetime machinery.
 */
export type ProjectileProfile = Readonly<{
  gravity: number
  airDrag: number
  waterDrag: number
  maxLifetimeSeconds: number
  shooterGraceSeconds: number
}>

/**
 * Bit-for-bit `@nerima-games/mc-kernel`'s `ARROW_GRAVITY`/`ARROW_AIR_DRAG`/
 * `ARROW_WATER_DRAG`/`ARROW_MAX_LIFETIME_SECONDS`/`ARROW_SHOOTER_GRACE_SECONDS`
 * (asserted in test/projectile.test.ts) — the kernel already owns the
 * Arrow-specific implementation; this profile only reuses its constants so
 * the generic engine below reproduces the same arrow trajectory.
 */
export const ARROW_PROFILE: ProjectileProfile = {
  airDrag: 0.99,
  gravity: 9.81,
  maxLifetimeSeconds: 60,
  shooterGraceSeconds: 0.25,
  waterDrag: 0.6,
}

/**
 * Java gives the snowball 0.03 blocks/tick² of gravity against the arrow's
 * 0.05 — a 0.6x ratio. `ARROW_PROFILE.gravity` is that same per-tick constant
 * already converted to this module's seconds basis, so applying the same
 * ratio there carries the conversion through unchanged: 9.81 * 0.6 = 5.886.
 */
export const SNOWBALL_PROFILE: ProjectileProfile = { ...ARROW_PROFILE, gravity: ARROW_PROFILE.gravity * 0.6 }

/** Java's egg shares the snowball's 0.03 blocks/tick² gravity exactly. */
export const EGG_PROFILE: ProjectileProfile = SNOWBALL_PROFILE

/**
 * Java's trident falls at the same 0.05 blocks/tick² as the arrow, but a
 * Riptide-capable trident travels underwater with almost no resistance
 * instead of the arrow's 0.6 water drag.
 */
export const TRIDENT_PROFILE: ProjectileProfile = { ...ARROW_PROFILE, waterDrag: 0.99 }

export type ProjectileEntity = Readonly<{ id: string; bounds: AABB }>
export type ProjectileWorld = Readonly<{
  blockBounds: (start: Position, end: Position) => readonly AABB[]
  entities: readonly ProjectileEntity[]
  isInWater: (position: Position) => boolean
  bounds: AABB
}>

export type ProjectileHit =
  | Readonly<{ kind: 'block'; point: Position; normal: Position; flightTimeSeconds: number }>
  | Readonly<{ kind: 'entity'; entityId: string; point: Position; normal: Position; flightTimeSeconds: number }>

type ProjectileBase = Readonly<{
  position: Position
  velocity: Position
  ageSeconds: number
  shooterId?: string
}>

export type Projectile =
  | (ProjectileBase & Readonly<{ state: 'flying' }>)
  | (ProjectileBase & Readonly<{ state: 'stuck'; hit: ProjectileHit; recoverable: boolean }>)
  | (ProjectileBase & Readonly<{ state: 'despawned'; reason: 'invalid' | 'lifetime' | 'world' | 'entity-hit' }>)

export type ProjectileLaunch = Readonly<{
  position: Position
  yawRadians: number
  pitchRadians: number
  speed: number
  shooterId?: string
}>

export type ProjectileStep = Readonly<{ projectile: Projectile; hit?: ProjectileHit }>

type SegmentHit = Readonly<{ fraction: number; point: Position; normal: Position }>

const finiteVec = (value: Position): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)

const validBox = (box: AABB): boolean =>
  Number.isFinite(box.minX) && Number.isFinite(box.minY) && Number.isFinite(box.minZ) &&
  Number.isFinite(box.maxX) && Number.isFinite(box.maxY) && Number.isFinite(box.maxZ) &&
  box.minX <= box.maxX && box.minY <= box.maxY && box.minZ <= box.maxZ

const contains = (box: AABB, point: Position): boolean =>
  point.x >= box.minX && point.x <= box.maxX &&
  point.y >= box.minY && point.y <= box.maxY &&
  point.z >= box.minZ && point.z <= box.maxZ

const segmentAABB = (start: Position, end: Position, box: AABB): SegmentHit | null => {
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
  return {
    fraction: near,
    normal: { x: normalX, y: normalY, z: normalZ },
    point: { x: start.x + deltaX * near, y: start.y + deltaY * near, z: start.z + deltaZ * near },
  }
}

const despawn = (
  projectile: ProjectileBase,
  reason: Extract<Projectile, { state: 'despawned' }>['reason'],
): ProjectileStep => ({
  projectile: { ...projectile, reason, state: 'despawned' },
})

/**
 * Launch kinematics are profile-independent: the initial velocity derives
 * only from yaw/pitch/speed. The profile enters at `stepProjectile`, so the
 * signature does not pretend otherwise by accepting one it would ignore.
 */
export const launchProjectile = (launch: ProjectileLaunch): Projectile => {
  const horizontalSpeed = Math.cos(launch.pitchRadians) * launch.speed
  const velocity = {
    x: -Math.sin(launch.yawRadians) * horizontalSpeed,
    y: -Math.sin(launch.pitchRadians) * launch.speed,
    z: -Math.cos(launch.yawRadians) * horizontalSpeed,
  }
  const base = { ageSeconds: 0, position: launch.position, velocity, ...(launch.shooterId === undefined ? {} : { shooterId: launch.shooterId }) }
  return finiteVec(launch.position) && finiteVec(velocity) && Number.isFinite(launch.speed) && launch.speed >= 0
    ? { ...base, state: 'flying' }
    : { ...base, reason: 'invalid', state: 'despawned' }
}

export const stepProjectile = (
  state: Projectile,
  dt: number,
  world: ProjectileWorld,
  profile: ProjectileProfile,
): ProjectileStep => {
  if (state.state !== 'flying') {return { projectile: state }}
  if (!finiteVec(state.position) || !finiteVec(state.velocity) || !Number.isFinite(state.ageSeconds) || state.ageSeconds < 0 || !Number.isFinite(dt) || dt <= 0 || !validBox(world.bounds)) {
    return despawn(state, 'invalid')
  }
  const ageSeconds = state.ageSeconds + dt
  if (!Number.isFinite(ageSeconds)) {return despawn({ ...state, ageSeconds }, 'invalid')}
  if (ageSeconds >= profile.maxLifetimeSeconds) {return despawn({ ...state, ageSeconds }, 'lifetime')}

  const drag = (world.isInWater(state.position) ? profile.waterDrag : profile.airDrag) ** (dt * 20)
  const velocity = {
    x: state.velocity.x * drag,
    y: (state.velocity.y - profile.gravity * dt) * drag,
    z: state.velocity.z * drag,
  }
  const end = {
    x: state.position.x + velocity.x * dt,
    y: state.position.y + velocity.y * dt,
    z: state.position.z + velocity.z * dt,
  }
  if (!finiteVec(velocity) || !finiteVec(end)) {return despawn({ ...state, ageSeconds }, 'invalid')}

  let first: (SegmentHit & Readonly<{ kind: 'block' | 'entity'; entityId?: string }>) | null = null
  for (const box of world.blockBounds(state.position, end)) {
    const hit = segmentAABB(state.position, end, box)
    if (hit !== null && (first === null || hit.fraction < first.fraction)) {first = { ...hit, kind: 'block' }}
  }
  for (const entity of world.entities) {
    if (entity.id === state.shooterId && state.ageSeconds < profile.shooterGraceSeconds) {continue}
    const hit = segmentAABB(state.position, end, entity.bounds)
    if (hit !== null && (first === null || hit.fraction < first.fraction)) {first = { ...hit, entityId: entity.id, kind: 'entity' }}
  }
  if (first !== null) {
    const flightTimeSeconds = state.ageSeconds + dt * first.fraction
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
    const base = { ...state, ageSeconds: flightTimeSeconds, position: first.point, velocity: { x: 0, y: 0, z: 0 } }
    return first.kind === 'block'
      ? { hit, projectile: { ...base, hit, recoverable: true, state: 'stuck' } }
      : { hit, projectile: { ...base, reason: 'entity-hit', state: 'despawned' } }
  }

  const next: Projectile = { ...state, ageSeconds, position: end, state: 'flying', velocity }
  return contains(world.bounds, end) ? { projectile: next } : despawn(next, 'world')
}
