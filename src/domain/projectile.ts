import {
  AngleRadians,
  DeltaTimeSecs,
  EntityId,
  type EntityId as EntityIdValue,
  FixedDurationSecs,
  type Position,
  PositionAxis,
  position,
} from '@nerima-games/mc-kernel'
import {
  BlocksPerSecond,
  BlocksPerSecondSquared,
  type VelocityVector,
  blockVectorResult,
  velocityVectorResult,
} from './physical-units.js'
import { Brand, Result } from 'effect'
import type { AABB } from './coordinates.js'

/**
 * A launched projectile's tunable physical behaviour, on a seconds basis (not
 * Minecraft's per-tick basis) so it composes directly with the `dt` this
 * module already integrates on. `launchProjectile`/`stepProjectile` take one
 * of these instead of hard-coding arrow constants, so a snowball, egg, or
 * trident reuses the same swept-segment collision and lifetime machinery.
 */
export type ProjectileProfile = Readonly<{
  gravity: BlocksPerSecondSquared
  airDrag: number
  waterDrag: number
  maxLifetimeSeconds: FixedDurationSecs
  shooterGraceSeconds: FixedDurationSecs
}>

/** The mc-physics arrow profile and its tuned flight limits. */
const ARROW_GRAVITY_BLOCKS_PER_SECOND_SQUARED = 9.81
const ARROW_MAX_LIFETIME_SECONDS = 60
const PROJECTILE_SHOOTER_GRACE_SECONDS = 0.25

export const ARROW_PROFILE: ProjectileProfile = {
  airDrag: 0.99,
  gravity: BlocksPerSecondSquared(ARROW_GRAVITY_BLOCKS_PER_SECOND_SQUARED),
  maxLifetimeSeconds: FixedDurationSecs(ARROW_MAX_LIFETIME_SECONDS),
  shooterGraceSeconds: FixedDurationSecs(PROJECTILE_SHOOTER_GRACE_SECONDS),
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
  gravity: BlocksPerSecondSquared(ARROW_PROFILE.gravity * SNOWBALL_GRAVITY_RATIO),
}

/** Java's egg shares the snowball's 0.03 blocks/tick² gravity exactly. */
export const EGG_PROFILE: ProjectileProfile = SNOWBALL_PROFILE

/**
 * Java's trident falls at the same 0.05 blocks/tick² as the arrow, but a
 * Riptide-capable trident travels underwater with almost no resistance
 * instead of the arrow's 0.6 water drag.
 */
export const TRIDENT_PROFILE: ProjectileProfile = { ...ARROW_PROFILE, waterDrag: 0.99 }

export type ProjectileEntity = Readonly<{ id: EntityIdValue; bounds: AABB }>
export type ProjectileWorld = Readonly<{
  blockBounds: (start: Position, end: Position) => readonly AABB[]
  entities: readonly ProjectileEntity[]
  isInWater: (position: Position) => boolean
  bounds: AABB
}>

export type ProjectileHit =
  | Readonly<{ kind: 'block'; point: Position; normal: Position; flightTimeSeconds: FixedDurationSecs }>
  | Readonly<{ kind: 'entity'; entityId: EntityIdValue; point: Position; normal: Position; flightTimeSeconds: FixedDurationSecs }>

type ProjectileBase = Readonly<{
  position: Position
  velocity: VelocityVector
  ageSeconds: FixedDurationSecs
  shooterId?: EntityIdValue
}>

export type Projectile =
  | (ProjectileBase & Readonly<{ state: 'flying' }>)
  | (ProjectileBase & Readonly<{ state: 'stuck'; hit: ProjectileHit; recoverable: boolean }>)
  | (ProjectileBase & Readonly<{ state: 'despawned'; reason: 'invalid' | 'lifetime' | 'world' | 'entity-hit' }>)

export type ProjectileLaunch = Readonly<{
  position: Position
  yawRadians: AngleRadians
  pitchRadians: AngleRadians
  speed: BlocksPerSecond
  shooterId?: EntityIdValue
}>

export type ProjectileStep = Readonly<{ projectile: Projectile; hit?: ProjectileHit }>

type SegmentHit = Readonly<{ fraction: number; point: Position; normal: Position }>

const positionResult = (x: number, y: number, z: number): Result.Result<Position, Brand.BrandError> =>
  Result.map(
    Result.all([PositionAxis.result(x), PositionAxis.result(y), PositionAxis.result(z)]),
    ([validX, validY, validZ]) => position(validX, validY, validZ),
  )

const ZERO_VELOCITY: VelocityVector = {
  x: BlocksPerSecond(0),
  y: BlocksPerSecond(0),
  z: BlocksPerSecond(0),
}

const validBox = (box: AABB): boolean =>
  Number.isFinite(box.minX) && Number.isFinite(box.minY) && Number.isFinite(box.minZ) &&
  Number.isFinite(box.maxX) && Number.isFinite(box.maxY) && Number.isFinite(box.maxZ) &&
  box.minX <= box.maxX && box.minY <= box.maxY && box.minZ <= box.maxZ

const aabbResult = (box: AABB): Result.Result<AABB, Brand.BrandError> =>
  Result.map(
    Result.all([
      PositionAxis.result(box.minX),
      PositionAxis.result(box.minY),
      PositionAxis.result(box.minZ),
      PositionAxis.result(box.maxX),
      PositionAxis.result(box.maxY),
      PositionAxis.result(box.maxZ),
    ]),
    ([minX, minY, minZ, maxX, maxY, maxZ]): AABB => ({ maxX, maxY, maxZ, minX, minY, minZ }),
  )

const contains = (box: AABB, point: Position): boolean =>
  point.x >= box.minX && point.x <= box.maxX &&
  point.y >= box.minY && point.y <= box.maxY &&
  point.z >= box.minZ && point.z <= box.maxZ

const ZERO_NORMAL: Position = position(PositionAxis(0), PositionAxis(0), PositionAxis(0))

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
    negativeNormal: position(PositionAxis(-1), PositionAxis(0), PositionAxis(0)),
    positiveNormal: position(PositionAxis(1), PositionAxis(0), PositionAxis(0)),
    start: start.x,
  },
  {
    delta: delta.y,
    max: box.maxY,
    min: box.minY,
    negativeNormal: position(PositionAxis(0), PositionAxis(-1), PositionAxis(0)),
    positiveNormal: position(PositionAxis(0), PositionAxis(1), PositionAxis(0)),
    start: start.y,
  },
  {
    delta: delta.z,
    max: box.maxZ,
    min: box.minZ,
    negativeNormal: position(PositionAxis(0), PositionAxis(0), PositionAxis(-1)),
    positiveNormal: position(PositionAxis(0), PositionAxis(0), PositionAxis(1)),
    start: start.z,
  },
]

const segmentAABB = (
  start: Position,
  end: Position,
  box: AABB,
): Result.Result<SegmentHit | null, Brand.BrandError | RangeError> => {
  const checkedBox = aabbResult(box)
  if (Result.isFailure(checkedBox)) {
    return Result.fail(checkedBox.failure)
  }
  if (!validBox(checkedBox.success)) {
    return Result.fail(new RangeError('Projectile collision box bounds are inverted'))
  }
  return Result.flatMap(positionResult(end.x - start.x, end.y - start.y, end.z - start.z), (delta) => {
    let far = 1
    let best: SlabWindow = { entry: 0, exit: 1, normal: ZERO_NORMAL }
    for (const slab of axisSlabs(start, delta, checkedBox.success)) {
      const window = slabWindow(slab)
      if (window === null) {
        return Result.succeed(null)
      }
      if (window.entry > best.entry) {
        best = window
      }
      far = Math.min(far, window.exit)
      if (best.entry > far) {
        return Result.succeed(null)
      }
    }
    const point = positionResult(
      start.x + delta.x * best.entry,
      start.y + delta.y * best.entry,
      start.z + delta.z * best.entry,
    )
    return Result.map(point, (value): SegmentHit => ({ fraction: best.entry, normal: best.normal, point: value }))
  })
}

const despawn = (
  projectile: ProjectileBase,
  reason: Extract<Projectile, { state: 'despawned' }>['reason'],
): ProjectileStep => ({
  projectile: { ...projectile, reason, state: 'despawned' },
})

type LaunchedBase = Readonly<{ ageSeconds: FixedDurationSecs; position: Position; velocity: VelocityVector }>

type ValidatedFlightInput = Readonly<{
  ageSeconds: FixedDurationSecs
  airDrag: number
  bounds: AABB
  dt: DeltaTimeSecs
  gravity: BlocksPerSecondSquared
  maxLifetimeSeconds: FixedDurationSecs
  position: Position
  shooterGraceSeconds: FixedDurationSecs
  shooterId: EntityIdValue | undefined
  velocity: VelocityVector
  waterDrag: number
}>

const withShooterId = (base: LaunchedBase, shooterId: EntityIdValue | undefined): ProjectileBase => {
  if (typeof shooterId !== 'undefined') {
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
  const launchPosition = launch.position
  const rawShooterId = launch.shooterId
  const checkedPosition = positionResult(launchPosition.x, launchPosition.y, launchPosition.z)
  const checkedYaw = AngleRadians.result(launch.yawRadians)
  const checkedPitch = AngleRadians.result(launch.pitchRadians)
  const checkedSpeed = BlocksPerSecond.result(launch.speed)
  let shooterId: EntityIdValue | undefined
  let validShooterId = true
  if (typeof rawShooterId !== 'undefined') {
    const checkedShooterId = EntityId.result(rawShooterId)
    if (Result.isSuccess(checkedShooterId)) {
      shooterId = checkedShooterId.success
    } else {
      validShooterId = false
    }
  }

  let velocity = ZERO_VELOCITY
  let validVelocity = false
  const checkedKinematics = Result.all([checkedYaw, checkedPitch, checkedSpeed])
  const checkedVelocity = Result.flatMap(checkedKinematics, ([yaw, pitch, speed]) => {
    const horizontalSpeed = Math.cos(pitch) * speed
    return velocityVectorResult(
      -Math.sin(yaw) * horizontalSpeed,
      -Math.sin(pitch) * speed,
      -Math.cos(yaw) * horizontalSpeed,
    )
  })
  if (Result.isSuccess(checkedVelocity)) {
    velocity = checkedVelocity.success
    validVelocity = true
  }

  let basePosition = ZERO_NORMAL
  if (Result.isSuccess(checkedPosition)) {
    basePosition = checkedPosition.success
  }
  const base = withShooterId({
    ageSeconds: FixedDurationSecs(0),
    position: basePosition,
    velocity,
  }, shooterId)
  const valid =
    Result.isSuccess(checkedPosition) &&
    Result.isSuccess(checkedYaw) &&
    Result.isSuccess(checkedPitch) &&
    Result.isSuccess(checkedSpeed) &&
    checkedSpeed.success >= 0 &&
    validShooterId &&
    validVelocity
  if (valid) {
    return { ...base, state: 'flying' }
  }
  return { ...base, reason: 'invalid', state: 'despawned' }
}

type CandidateHit = SegmentHit &
  (Readonly<{ kind: 'block' }> | Readonly<{ kind: 'entity'; entityId: EntityIdValue }>)

/** Ties go to whichever candidate was already `first`, i.e. to array/search order. */
const earlierHit = (first: CandidateHit | null, candidate: CandidateHit): CandidateHit => {
  if (first === null || candidate.fraction < first.fraction) {
    return candidate
  }
  return first
}

const firstBlockHit = (
  start: Position,
  end: Position,
  world: ProjectileWorld,
): Result.Result<CandidateHit | null, Brand.BrandError | RangeError> =>
  world.blockBounds(start, end).reduce<Result.Result<CandidateHit | null, Brand.BrandError | RangeError>>(
    (previous, box) => Result.flatMap(previous, (previousHit) =>
      Result.map(segmentAABB(start, end, box), (hit) => (hit && earlierHit(previousHit, { ...hit, kind: 'block' })) ?? previousHit),
    ),
    Result.succeed(null),
  )

const firstEntityHit = (
  start: Position,
  end: Position,
  world: ProjectileWorld,
  shooterId: EntityIdValue | undefined,
  ageSeconds: FixedDurationSecs,
  shooterGraceSeconds: FixedDurationSecs,
): Result.Result<CandidateHit | null, Brand.BrandError | RangeError> => {
  let first: Result.Result<CandidateHit | null, Brand.BrandError | RangeError> = Result.succeed(null)
  for (const entity of world.entities) {
    first = Result.flatMap(first, (priorHit) =>
      Result.flatMap(EntityId.result(entity.id), (entityId) => {
        const withinShooterGrace = entityId === shooterId && ageSeconds < shooterGraceSeconds
        if (withinShooterGrace) {
          return Result.succeed(priorHit)
        }
        return Result.map(segmentAABB(start, end, entity.bounds), (hit) => {
          if (hit === null) {
            return priorHit
          }
          return earlierHit(priorHit, { ...hit, entityId, kind: 'entity' })
        })
      }),
    )
  }
  return first
}

/** Blocks are searched first, so an exact fraction tie between a block and an entity keeps the block (matches `earlierHit`'s tie rule). */
const firstHit = (
  state: ProjectileBase,
  end: Position,
  world: ProjectileWorld,
  shooterGraceSeconds: FixedDurationSecs,
): Result.Result<CandidateHit | null, Brand.BrandError | RangeError> => Result.flatMap(firstBlockHit(state.position, end, world), (blockHit) =>
  Result.map(firstEntityHit(
    state.position,
    end,
    world,
    state.shooterId,
    state.ageSeconds,
    shooterGraceSeconds,
  ), (entityHit) => {
    if (blockHit === null) {
      return entityHit
    }
    if (entityHit === null) {
      return blockHit
    }
    return earlierHit(blockHit, entityHit)
  }),
)

const buildHitResult = (
  state: Extract<Projectile, { state: 'flying' }>,
  dt: DeltaTimeSecs,
  first: CandidateHit,
): ProjectileStep => {
  const flightTimeSeconds = FixedDurationSecs(state.ageSeconds + dt * first.fraction)
  const base = {
    ...state,
    ageSeconds: flightTimeSeconds,
    position: first.point,
    velocity: ZERO_VELOCITY,
  }
  if (first.kind === 'block') {
    const hit: ProjectileHit = {
      flightTimeSeconds,
      kind: 'block',
      normal: first.normal,
      point: first.point,
    }
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

const validatedFlightInput = (
  state: ProjectileBase,
  dt: DeltaTimeSecs,
  world: ProjectileWorld,
  profile: ProjectileProfile,
): Result.Result<ValidatedFlightInput | null, Brand.BrandError> => {
  const statePosition = state.position
  const stateVelocity = state.velocity
  const stateAgeSeconds = state.ageSeconds
  const rawShooterId = state.shooterId
  const gravityInput = profile.gravity
  const maxLifetimeInput = profile.maxLifetimeSeconds
  const shooterGraceInput = profile.shooterGraceSeconds
  const { airDrag, waterDrag } = profile
  let shooterId: Result.Result<EntityIdValue | undefined, Brand.BrandError>
  if (typeof rawShooterId === 'undefined') {
    shooterId = Result.succeed(globalThis.undefined)
  } else {
    shooterId = EntityId.result(rawShooterId)
  }
  const checked = Result.all([
    positionResult(statePosition.x, statePosition.y, statePosition.z),
    velocityVectorResult(stateVelocity.x, stateVelocity.y, stateVelocity.z),
    FixedDurationSecs.result(stateAgeSeconds),
    shooterId,
    DeltaTimeSecs.result(dt),
    BlocksPerSecondSquared.result(gravityInput),
    FixedDurationSecs.result(maxLifetimeInput),
    FixedDurationSecs.result(shooterGraceInput),
  ])
  if (Result.isFailure(checked)) {
    return Result.fail(checked.failure)
  }

  const [checkedPosition, velocity, ageSeconds, checkedShooterId, checkedDt, gravity, maxLifetimeSeconds, shooterGraceSeconds] = checked.success
  if (
    ageSeconds < 0 ||
    checkedDt <= 0 ||
    !Number.isFinite(airDrag) ||
    !Number.isFinite(waterDrag)
  ) {
    return Result.succeed(null)
  }
  const checkedBounds = aabbResult(world.bounds)
  if (Result.isFailure(checkedBounds)) {
    return Result.fail(checkedBounds.failure)
  }
  if (!validBox(checkedBounds.success)) {
    return Result.succeed(null)
  }
  return Result.succeed({
    ageSeconds,
    airDrag,
    bounds: checkedBounds.success,
    dt: checkedDt,
    gravity,
    maxLifetimeSeconds,
    position: checkedPosition,
    shooterGraceSeconds,
    shooterId: checkedShooterId,
    velocity,
    waterDrag,
  })
}

/** Minecraft simulates physics at 20 ticks per second; drag is defined per-tick, so raising it to `dt * MINECRAFT_TICKS_PER_SECOND` converts the per-tick factor to this module's per-second `dt` basis. */
const MINECRAFT_TICKS_PER_SECOND = 20

const dragFactorFor = (
  projectilePosition: Position,
  dt: DeltaTimeSecs,
  world: ProjectileWorld,
  airDrag: number,
  waterDrag: number,
): number => {
  let drag = airDrag
  if (world.isInWater(projectilePosition)) {
    drag = waterDrag
  }
  return drag ** (dt * MINECRAFT_TICKS_PER_SECOND)
}

export const stepProjectile = (
  state: Projectile,
  dt: DeltaTimeSecs,
  world: ProjectileWorld,
  profile: ProjectileProfile,
): ProjectileStep => {
  if (state.state !== 'flying') {
    return { projectile: state }
  }
  const checkedInput = validatedFlightInput(state, dt, world, profile)
  if (Result.isFailure(checkedInput) || checkedInput.success === null) {
    return despawn(state, 'invalid')
  }
  const input = checkedInput.success
  const flightState: Extract<Projectile, { state: 'flying' }> = {
    ...withShooterId({ ageSeconds: input.ageSeconds, position: input.position, velocity: input.velocity }, input.shooterId),
    state: 'flying',
  }

  const ageSeconds = FixedDurationSecs.result(input.ageSeconds + input.dt)
  if (Result.isFailure(ageSeconds)) {
    return despawn(flightState, 'invalid')
  }
  if (ageSeconds.success >= input.maxLifetimeSeconds) {
    return despawn({ ...flightState, ageSeconds: ageSeconds.success }, 'lifetime')
  }

  const drag = dragFactorFor(input.position, input.dt, world, input.airDrag, input.waterDrag)
  const velocity = velocityVectorResult(
    input.velocity.x * drag,
    (input.velocity.y - input.gravity * input.dt) * drag,
    input.velocity.z * drag,
  )
  if (Result.isFailure(velocity)) {
    return despawn({ ...flightState, ageSeconds: ageSeconds.success }, 'invalid')
  }

  const displacement = blockVectorResult(
    velocity.success.x * input.dt,
    velocity.success.y * input.dt,
    velocity.success.z * input.dt,
  )
  if (Result.isFailure(displacement)) {
    return despawn({ ...flightState, ageSeconds: ageSeconds.success }, 'invalid')
  }
  const end = positionResult(
    input.position.x + displacement.success.x,
    input.position.y + displacement.success.y,
    input.position.z + displacement.success.z,
  )
  if (Result.isFailure(end)) {
    return despawn({ ...flightState, ageSeconds: ageSeconds.success, velocity: velocity.success }, 'invalid')
  }

  const hit = firstHit(flightState, end.success, world, input.shooterGraceSeconds)
  if (Result.isFailure(hit)) {
    return despawn({ ...flightState, ageSeconds: ageSeconds.success, velocity: velocity.success }, 'invalid')
  }
  if (hit.success !== null) {
    return buildHitResult(flightState, input.dt, hit.success)
  }

  const next: Projectile = {
    ...flightState,
    ageSeconds: ageSeconds.success,
    position: end.success,
    state: 'flying',
    velocity: velocity.success,
  }
  if (contains(input.bounds, end.success)) {
    return { projectile: next }
  }
  return despawn(next, 'world')
}
