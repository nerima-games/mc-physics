import { type AABB, CONTACT_EPSILON, CentreY, HalfHeight } from './coordinates.js'
import { BlockAxis, DeltaTimeSecs, type PositionAxis } from '@nerima-games/mc-kernel'
import { BlockLength, BlocksPerSecond } from './physical-units.js'
import { Brand, Result } from 'effect'
import type { ResolveError, ResolveOptions } from './resolve-types.js'
import { forEachCollidingBlock } from './resolve-shapes.js'

const ZERO_VELOCITY = BlocksPerSecond(0)

export type AxisState<AxisPosition extends PositionAxis | CentreY = PositionAxis | CentreY> = {
  readonly blocked: boolean
  readonly position: AxisPosition
  readonly velocity: BlocksPerSecond
  /**
   * Set only when a downward floor impact was reflected by bounciness, so
   * `velocity` points away from the surface it just touched rather than
   * resting on it. `resolveBody` reads this to keep a bounced body from
   * reporting grounded on the frame it leaves the floor.
   */
  readonly bounced?: boolean
}

type AxisFaceAccessors<AxisPosition extends PositionAxis | CentreY> = Readonly<{
  farFace: (block: AABB) => number
  nearFace: (block: AABB) => number
  positionResult: (value: number) => Result.Result<AxisPosition, Brand.BrandError>
}>

/** Only a finite value in [0, 1] is a meaningful bounciness; anything else (unset, NaN, negative) means none. */
const clampBounciness = (value: number | undefined): number => {
  const candidate = value ?? Number.NaN
  if (!Number.isFinite(candidate)) {
    return 0
  }
  return Math.min(1, Math.max(0, candidate))
}

export const clampAxis = <AxisPosition extends PositionAxis | CentreY>(
  state: AxisState<AxisPosition>,
  bodyMin: number,
  bodyMax: number,
  halfExtent: BlockLength | HalfHeight,
  options: ResolveOptions,
  box: AABB,
  accessors: AxisFaceAccessors<AxisPosition>,
): Result.Result<AxisState<AxisPosition>, ResolveError> => {
  const checkedState = Result.all([
    accessors.positionResult(Number(state.position)),
    BlocksPerSecond.result(state.velocity),
  ])
  if (Result.isFailure(checkedState)) {
    return Result.fail(checkedState.failure)
  }
  const [position, velocity] = checkedState.success
  const validState: AxisState<AxisPosition> = { ...state, position, velocity }

  if (velocity > 0) {
    let face = Number.POSITIVE_INFINITY
    const visited = forEachCollidingBlock(options, box, (block) => {
      const candidateFace = accessors.nearFace(block)
      if (candidateFace >= bodyMin) {
        face = Math.min(face, candidateFace)
      }
    })
    if (Result.isFailure(visited)) {
      return Result.fail(visited.failure)
    }
    if (face < Number.POSITIVE_INFINITY) {
      return Result.map(accessors.positionResult(face - halfExtent), (resolvedPosition): AxisState<AxisPosition> => ({
        blocked: true,
        position: resolvedPosition,
        velocity: ZERO_VELOCITY,
      }))
    }
    return Result.succeed(validState)
  }

  if (velocity < 0) {
    let face = Number.NEGATIVE_INFINITY
    const visited = forEachCollidingBlock(options, box, (block) => {
      const candidateFace = accessors.farFace(block)
      if (candidateFace <= bodyMax) {
        face = Math.max(face, candidateFace)
      }
    })
    if (Result.isFailure(visited)) {
      return Result.fail(visited.failure)
    }
    if (face > Number.NEGATIVE_INFINITY) {
      return Result.map(accessors.positionResult(face + halfExtent), (resolvedPosition): AxisState<AxisPosition> => ({
        blocked: true,
        position: resolvedPosition,
        velocity: ZERO_VELOCITY,
      }))
    }
    return Result.succeed(validState)
  }

  return Result.succeed(validState)
}

export const resolveVertical = (
  options: ResolveOptions,
  box: AABB,
  state: AxisState<CentreY>,
  deltaTime: DeltaTimeSecs,
): Result.Result<AxisState<CentreY>, ResolveError> => {
  const velocitySnapshot = state.velocity
  const deltaSnapshot = deltaTime
  const checkedInputs = Result.all([
    BlocksPerSecond.result(velocitySnapshot),
    DeltaTimeSecs.result(deltaSnapshot),
  ])
  if (Result.isFailure(checkedInputs)) {
    return Result.fail(checkedInputs.failure)
  }
  const [velocity, validDeltaTime] = checkedInputs.success

  /*
   * A resting body (velocity exactly 0) sits a contact-epsilon gap above its
   * floor, so no colliding block can satisfy the floor test below:
   * `collidesWith` demands more than CONTACT_EPSILON of overlap while the
   * floor test accepts at most that much reach. Returning early states that
   * invariant instead of hiding it in an unreachable bounce guard (P-6).
   */
  if (velocity === 0) {
    return Result.succeed(state)
  }

  if (velocity < 0) {
    const checkedReach = BlockLength.result(-velocity * validDeltaTime + CONTACT_EPSILON)
    if (Result.isFailure(checkedReach)) {
      return Result.fail(checkedReach.failure)
    }
    let floorTop = Number.NEGATIVE_INFINITY
    let floorCell: readonly [number, number, number] = [0, 0, 0]
    const visited = forEachCollidingBlock(options, box, (block) => {
      if (block.maxY - box.minY <= checkedReach.success && block.maxY > floorTop) {
        floorTop = block.maxY
        floorCell = [Math.floor(block.minX), Math.floor(block.minY), Math.floor(block.minZ)]
      }
    })
    if (Result.isFailure(visited)) {
      return Result.fail(visited.failure)
    }
    if (floorTop > Number.NEGATIVE_INFINITY) {
      const [bx, by, bz] = floorCell
      const checkedCell = Result.all([BlockAxis.result(bx), BlockAxis.result(by), BlockAxis.result(bz)])
      if (Result.isFailure(checkedCell)) {
        return Result.fail(checkedCell.failure)
      }
      const [blockX, blockY, blockZ] = checkedCell.success
      const bounciness = clampBounciness(options.bouncinessAt?.(blockX, blockY, blockZ))
      const position = CentreY.result(floorTop + options.halfHeight)
      if (Result.isFailure(position)) {
        return Result.fail(position.failure)
      }
      if (bounciness > 0) {
        return Result.map(BlocksPerSecond.result(-velocity * bounciness), (bouncedVelocity): AxisState<CentreY> => ({
          blocked: true,
          bounced: true,
          position: position.success,
          velocity: bouncedVelocity,
        }))
      }
      return Result.succeed({ blocked: true, position: position.success, velocity: ZERO_VELOCITY })
    }
    return Result.succeed(state)
  }

  const checkedReach = BlockLength.result(velocity * validDeltaTime + CONTACT_EPSILON)
  if (Result.isFailure(checkedReach)) {
    return Result.fail(checkedReach.failure)
  }
  let ceiling = Number.POSITIVE_INFINITY
  const visited = forEachCollidingBlock(options, box, (block) => {
    if (box.maxY - block.minY <= checkedReach.success) {
      ceiling = Math.min(ceiling, block.minY)
    }
  })
  if (Result.isFailure(visited)) {
    return Result.fail(visited.failure)
  }
  if (ceiling < Number.POSITIVE_INFINITY) {
    return Result.map(CentreY.result(ceiling - options.halfHeight), (position): AxisState<CentreY> => ({
      blocked: true,
      position,
      velocity: ZERO_VELOCITY,
    }))
  }
  return Result.succeed(state)
}
