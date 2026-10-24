import type { BlockAxis, BlockProperties, PositionAxis } from '@nerima-games/mc-kernel'
import type { BlockEnvironment, BlockHazards } from './environment-types.js'
import type { BlockShape, HalfHeight } from './coordinates.js'
import type { BlockLength } from './physical-units.js'
import type { Body } from './integrate.js'
import type { Brand } from 'effect'

export type ResolveError = Brand.BrandError | RangeError

export type BlockPropertiesAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => BlockProperties | null

export type BlockShapeAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => BlockShape | null

export type ResolveOptions = {
  readonly halfWidth: BlockLength
  readonly halfHeight: HalfHeight
  readonly environment: BlockEnvironment
  readonly blockPropertiesAt: BlockPropertiesAt
  /** Optional state-specific or compound geometry. When supplied, it is authoritative. */
  readonly blockShapeAt?: BlockShapeAt
  readonly stepHeight?: BlockLength
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

export type HasGroundSupport = (positionX: PositionAxis, positionZ: PositionAxis) => boolean
