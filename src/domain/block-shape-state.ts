import type {
  BlockAxis,
  BlockStateCodecFailure,
  BlockStateConnectionValue,
  BlockStateConnections,
  BlockStateFacing,
  BlockStateHalf,
  BlockStateHinge,
  BlockStateLayers,
  BlockStatePart,
  BlockStateShape,
  BlockStateType,
  BlockType,
  EffectiveBlockStateValues,
  EncodedBlockState,
} from '@nerima-games/mc-kernel'
import type { BlockShape } from './coordinates.js'
import type { Result } from 'effect'

export type {
  BlockStateCodecFailure,
  BlockStateConnectionValue,
  BlockStateConnections,
  BlockStateFacing,
  BlockStateHalf,
  BlockStateHinge,
  BlockStateLayers,
  BlockStatePart,
  BlockStateShape,
  BlockStateType,
  BlockType,
  EncodedBlockState,
  EffectiveBlockStateValues,
}

/** Encoded state stored for a block cell; undefined asks the kernel for its default. */
export type BlockStateAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => EncodedBlockState | undefined

/** State-specific geometry outside the kernel's current block-state table. */
export type CustomBlockShapeStateInput =
  | Readonly<{ kind: 'fence'; connections?: BlockStateConnections }>
  | Readonly<{ kind: 'wall'; connections?: BlockStateConnections }>
  | Readonly<{ kind: 'trapdoor'; facing: Extract<BlockStateFacing, 'north' | 'east' | 'south' | 'west'>; half: Extract<BlockStateHalf, 'bottom' | 'top'>; open: boolean }>
  | Readonly<{ kind: 'carpet' }>
  | Readonly<{ kind: 'soulSand' }>

/** Per-cell state for PH1 geometry without a kernel definition row. */
export type CustomBlockShapeStateAt = (
  bx: BlockAxis,
  by: BlockAxis,
  bz: BlockAxis,
) => CustomBlockShapeStateInput | null

export type BlockStateLookupFailure = Readonly<{
  readonly _tag: 'BlockStateLookupFailure'
  readonly reason: 'missing-block-id'
}>

export type BlockFacing = Extract<BlockStateFacing, 'north' | 'east' | 'south' | 'west'>
export type BlockHalf = Extract<BlockStateHalf, 'bottom' | 'top'>
export type DoorHalf = Extract<BlockStateHalf, 'lower' | 'upper'>
export type StairShape = Extract<BlockStateShape, 'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right'>
export type WallConnection = BlockStateConnectionValue
export type SnowLayerCount = BlockStateLayers

export type BlockShapeLookup = BlockShape | null | Result.Result<BlockShape | null, RangeError>

/** Custom geometry can inspect the kernel-resolved identity and values. */
export type BlockShapeAt = (
  bx: BlockAxis,
  by: BlockAxis,
  bz: BlockAxis,
  state?: EffectiveBlockStateValues | null,
  blockType?: BlockType,
) => BlockShapeLookup
