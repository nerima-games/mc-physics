import type { BlockAxis, BlockProperties, PositionAxis } from '@nerima-games/mc-kernel'
import type { BlockEnvironment, BlockHazards, BlockLookupError, EnvironmentError } from './environment-types.js'
import type { BlockShapeAt, BlockStateAt, CustomBlockShapeStateAt } from './block-shape-state.js'
import type { BlockLength } from './physical-units.js'
import type { Body } from './integrate.js'
import type { HalfHeight } from './coordinates.js'
import type { Result } from 'effect'

export type { BlockShapeAt, BlockStateAt, CustomBlockShapeStateAt } from './block-shape-state.js'

export type ResolveError = EnvironmentError

export type BlockPropertiesAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => Result.Result<BlockProperties | null, BlockLookupError>

export type ResolveOptions = {
  readonly halfWidth: BlockLength
  readonly halfHeight: HalfHeight
  readonly environment: BlockEnvironment
  readonly blockPropertiesAt: BlockPropertiesAt
  /** Optional state-specific or compound geometry. When supplied, it is authoritative. */
  readonly blockShapeAt?: BlockShapeAt
  /** Kernel block identity for resolving the encoded state at each cell. */
  readonly blockIdAt?: NonNullable<BlockEnvironment['blockIdAt']>
  /** Encoded kernel state; undefined selects the kernel default for the block id. */
  readonly blockStateAt?: BlockStateAt
  /** Per-cell PH1 state for geometry not represented in the kernel definition table. */
  readonly customBlockShapeStateAt?: CustomBlockShapeStateAt
  readonly stepHeight?: BlockLength
  /** Prevent moving more than 0.6 blocks down while crouching. */
  readonly sneaking?: boolean
  /**
   * Slime-block/bed style bounce. Sampled at the block cell contacted by a
   * genuine downward floor impact only — resting contact and ceiling/wall
   * hits are unaffected. Clamped to [0, 1]; unset or 0 is the plain vy=0
   * clamp.
   */
  readonly bouncinessAt?: (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => number
}

export type Resolution = {
  readonly body: Body
  readonly isGrounded: boolean
  readonly hazards: BlockHazards
}

export type HorizontalPosition = {
  readonly x: PositionAxis
  readonly z: PositionAxis
}

export type HasGroundSupport = (
  positionX: PositionAxis,
  positionZ: PositionAxis,
  maxStepDown: BlockLength,
) => Result.Result<boolean, ResolveError>
