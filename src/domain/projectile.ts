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
 * 0.05 — a 0.6x ratio (`SNOWBALL_GRAVITY_RATIO`). `ARROW_PROFILE.gravity` is
 * that same per-tick constant already converted to this module's seconds
 * basis, so applying the same ratio there carries the conversion through
 * unchanged: 9.81 * 0.6 = 5.886.
 */
const SNOWBALL_GRAVITY_RATIO = 0.6
export const SNOWBALL_PROFILE: ProjectileProfile = {
  ...ARROW_PROFILE,
  gravity: ARROW_PROFILE.gravity * SNOWBALL_GRAVITY_RATIO,
}

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

const ZERO_NORMAL: Position = { x: 0, y: 0, z: 0 }

type AxisSlab = Readonly<{
  delta: number
  max: number
  min: number
  negativeNormal: Position
  positiveNormal: Position
  start: number
}>

type SlabWindow = Readonly<{ entry: number; exit: number; normal: Position }>

/**
 * A zero-delta axis never leaves its start value, so it neither narrows the
 * [entry, exit] window nor contributes a face normal — reported here as the
 * widest-possible window ([-Infinity, Infinity], no normal) rather than via a
 * `continue` in the caller's loop, so the caller has one shape to fold over
 * regardless of axis.
 */
const slabWindow = (slab: AxisSlab): SlabWindow | null => {
  if (slab.delta === 0) {
    if (slab.start < slab.min || slab.start > slab.max) {
      return null
    }
    return { entry: Number.NEGATIVE_INFINITY, exit: Number.POSITIVE_INFINITY, normal: ZERO_NORMAL }
  }
  const low = (slab.min - slab.start) / slab.delta
  const high = (slab.max - slab.start) / slab.delta
  let normal = slab.positiveNormal
  if (slab.delta > 0) {
    normal = slab.negativeNormal
  }
  return { entry: Math.min(low, high), exit: Math.max(low, high), normal }
}

const axisSlabs = (start: Position, delta: Position, box: AABB): readonly AxisSlab[] => [
  {
    delta: delta.x,
    max: box.maxX,
    min: box.minX,
    negativeNormal: { x: -1, y: 0, z: 0 },
    positiveNormal: { x: 1, y: 0, z: 0 },
    start: start.x,
  },
  {
    delta: delta.y,
    max: box.maxY,
    min: box.minY,
    negativeNormal: { x: 0, y: -1, z: 0 },
    positiveNormal: { x: 0, y: 1, z: 0 },
    start: start.y,
  },
  {
    delta: delta.z,
    max: box.maxZ,
    min: box.minZ,
    negativeNormal: { x: 0, y: 0, z: -1 },
    positiveNormal: { x: 0, y: 0, z: 1 },
    start: start.z,
  },
]

const segmentAABB = (start: Position, end: Position, box: AABB): SegmentHit | null => {
  if (!validBox(box)) {
    return null
  }
  const delta: Position = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z }
  let far = 1
  let best: SlabWindow = { entry: 0, exit: 1, normal: ZERO_NORMAL }
  for (const slab of axisSlabs(start, delta, box)) {
    const window = slabWindow(slab)
    if (window === null) {
      return null
    }
    if (window.entry > best.entry) {
      best = window
    }
    far = Math.min(far, window.exit)
    if (best.entry > far) {
      return null
    }
  }
  return {
    fraction: best.entry,
    normal: best.normal,
    point: {
      x: start.x + delta.x * best.entry,
      y: start.y + delta.y * best.entry,
      z: start.z + delta.z * best.entry,
    },
  }
}

const despawn = (
  projectile: ProjectileBase,
  reason: Extract<Projectile, { state: 'despawned' }>['reason'],
): ProjectileStep => ({
  projectile: { ...projectile, reason, state: 'despawned' },
})

type LaunchedBase = Readonly<{ ageSeconds: number; position: Position; velocity: Position }>

const withShooterId = (base: LaunchedBase, shooterId: string | undefined): ProjectileBase => {
  if (typeof shooterId === 'string') {
    return { ...base, shooterId }
  }
  return base
}

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
  const base = withShooterId({ ageSeconds: 0, position: launch.position, velocity }, launch.shooterId)
  const isValidLaunch =
    finiteVec(launch.position) && finiteVec(velocity) && Number.isFinite(launch.speed) && launch.speed >= 0
  if (isValidLaunch) {
    return { ...base, state: 'flying' }
  }
  return { ...base, reason: 'invalid', state: 'despawned' }
}

type CandidateHit = SegmentHit &
  (Readonly<{ kind: 'block' }> | Readonly<{ kind: 'entity'; entityId: string }>)

/** Ties go to whichever candidate was already `first`, i.e. to array/search order. */
const earlierHit = (first: CandidateHit | null, candidate: CandidateHit): CandidateHit => {
  if (first === null || candidate.fraction < first.fraction) {
    return candidate
  }
  return first
}

const firstBlockHit = (start: Position, end: Position, world: ProjectileWorld): CandidateHit | null => {
  let first: CandidateHit | null = null
  for (const box of world.blockBounds(start, end)) {
    const hit = segmentAABB(start, end, box)
    if (hit !== null) {
      first = earlierHit(first, { ...hit, kind: 'block' })
    }
  }
  return first
}

const firstEntityHit = (
  start: Position,
  end: Position,
  world: ProjectileWorld,
  shooterId: string | undefined,
  ageSeconds: number,
  shooterGraceSeconds: number,
): CandidateHit | null => {
  let first: CandidateHit | null = null
  for (const entity of world.entities) {
    const withinShooterGrace = entity.id === shooterId && ageSeconds < shooterGraceSeconds
    if (!withinShooterGrace) {
      const hit = segmentAABB(start, end, entity.bounds)
      if (hit !== null) {
        first = earlierHit(first, { ...hit, entityId: entity.id, kind: 'entity' })
      }
    }
  }
  return first
}

/** Blocks are searched first, so an exact fraction tie between a block and an entity keeps the block (matches `earlierHit`'s tie rule). */
const firstHit = (
  state: ProjectileBase,
  end: Position,
  world: ProjectileWorld,
  profile: ProjectileProfile,
): CandidateHit | null => {
  const blockHit = firstBlockHit(state.position, end, world)
  const entityHit = firstEntityHit(state.position, end, world, state.shooterId, state.ageSeconds, profile.shooterGraceSeconds)
  if (blockHit === null) {
    return entityHit
  }
  if (entityHit === null) {
    return blockHit
  }
  return earlierHit(blockHit, entityHit)
}

const buildHitResult = (
  state: Extract<Projectile, { state: 'flying' }>,
  dt: number,
  first: CandidateHit,
): ProjectileStep => {
  const flightTimeSeconds = state.ageSeconds + dt * first.fraction
  const base = { ...state, ageSeconds: flightTimeSeconds, position: first.point, velocity: { x: 0, y: 0, z: 0 } }
  if (first.kind === 'block') {
    const hit: ProjectileHit = { flightTimeSeconds, kind: 'block', normal: first.normal, point: first.point }
    return { hit, projectile: { ...base, hit, recoverable: true, state: 'stuck' } }
  }
  const hit: ProjectileHit = {
    entityId: first.entityId,
    flightTimeSeconds,
    kind: 'entity',
    normal: first.normal,
    point: first.point,
  }
  return { hit, projectile: { ...base, reason: 'entity-hit', state: 'despawned' } }
}

const isInvalidFlightInput = (state: ProjectileBase, dt: number, world: ProjectileWorld): boolean =>
  !finiteVec(state.position) ||
  !finiteVec(state.velocity) ||
  !Number.isFinite(state.ageSeconds) ||
  state.ageSeconds < 0 ||
  !Number.isFinite(dt) ||
  dt <= 0 ||
  !validBox(world.bounds)

/** Minecraft simulates physics at 20 ticks per second; drag is defined per-tick, so raising it to `dt * MINECRAFT_TICKS_PER_SECOND` converts the per-tick factor to this module's per-second `dt` basis. */
const MINECRAFT_TICKS_PER_SECOND = 20

const dragFactorFor = (position: Position, dt: number, world: ProjectileWorld, profile: ProjectileProfile): number => {
  let drag = profile.airDrag
  if (world.isInWater(position)) {
    drag = profile.waterDrag
  }
  return drag ** (dt * MINECRAFT_TICKS_PER_SECOND)
}

export const stepProjectile = (
  state: Projectile,
  dt: number,
  world: ProjectileWorld,
  profile: ProjectileProfile,
): ProjectileStep => {
  if (state.state !== 'flying') {
    return { projectile: state }
  }
  if (isInvalidFlightInput(state, dt, world)) {
    return despawn(state, 'invalid')
  }

  const ageSeconds = state.ageSeconds + dt
  if (!Number.isFinite(ageSeconds)) {
    return despawn({ ...state, ageSeconds }, 'invalid')
  }
  if (ageSeconds >= profile.maxLifetimeSeconds) {
    return despawn({ ...state, ageSeconds }, 'lifetime')
  }

  const drag = dragFactorFor(state.position, dt, world, profile)
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
  if (!finiteVec(velocity) || !finiteVec(end)) {
    /*
     * Kernel's stepArrow records the freshly computed velocity on this
     * despawn; keeping the stale one broke bit-for-bit ARROW_PROFILE parity.
     */
    return despawn({ ...state, ageSeconds, velocity }, 'invalid')
  }

  const first = firstHit(state, end, world, profile)
  if (first !== null) {
    return buildHitResult(state, dt, first)
  }

  const next: Projectile = { ...state, ageSeconds, position: end, state: 'flying', velocity }
  if (contains(world.bounds, end)) {
    return { projectile: next }
  }
  return despawn(next, 'world')
}
