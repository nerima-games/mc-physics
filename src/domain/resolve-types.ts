import type { BlockShape, HalfHeight } from './coordinates'
import type { BlockProperties } from '@nerima-games/mc-kernel'
import type { Body } from './integrate'

export type BlockPropertiesAt = (bx: number, by: number, bz: number) => BlockProperties | null

export type BlockShapeAt = (bx: number, by: number, bz: number) => BlockShape | null

export type ResolveOptions = {
  readonly halfWidth: number
  readonly halfHeight: HalfHeight
  readonly blockPropertiesAt: BlockPropertiesAt
  /** Optional state-specific or compound geometry. When supplied, it is authoritative. */
  readonly blockShapeAt?: BlockShapeAt
  readonly stepHeight?: number
}

export type Resolution = {
  readonly body: Body
  readonly isGrounded: boolean
}

export type HorizontalPosition = {
  readonly x: number
  readonly z: number
}

export type HasGroundSupport = (positionX: number, positionZ: number) => boolean
