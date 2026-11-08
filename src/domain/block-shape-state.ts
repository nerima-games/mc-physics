import type { BlockAxis } from '@nerima-games/mc-kernel'
import type { BlockShape } from './coordinates.js'
import type { Result } from 'effect'

export type BlockFacing = 'north' | 'east' | 'south' | 'west'
export type BlockHalf = 'bottom' | 'top'
export type StairShape = 'straight' | 'innerLeft' | 'innerRight' | 'outerLeft' | 'outerRight'
export type WallConnection = 'none' | 'low' | 'tall'
export const ONE_SNOW_LAYER = 1
export const TWO_SNOW_LAYERS = 2
export const THREE_SNOW_LAYERS = 3
export const FOUR_SNOW_LAYERS = 4
export const FIVE_SNOW_LAYERS = 5
export const SIX_SNOW_LAYERS = 6
export const SEVEN_SNOW_LAYERS = 7
export const EIGHT_SNOW_LAYERS = 8
export const SNOW_LAYER_COUNTS: readonly [
  typeof ONE_SNOW_LAYER,
  typeof TWO_SNOW_LAYERS,
  typeof THREE_SNOW_LAYERS,
  typeof FOUR_SNOW_LAYERS,
  typeof FIVE_SNOW_LAYERS,
  typeof SIX_SNOW_LAYERS,
  typeof SEVEN_SNOW_LAYERS,
  typeof EIGHT_SNOW_LAYERS,
] = [
  ONE_SNOW_LAYER,
  TWO_SNOW_LAYERS,
  THREE_SNOW_LAYERS,
  FOUR_SNOW_LAYERS,
  FIVE_SNOW_LAYERS,
  SIX_SNOW_LAYERS,
  SEVEN_SNOW_LAYERS,
  EIGHT_SNOW_LAYERS,
] as const
export type SnowLayerCount = (typeof SNOW_LAYER_COUNTS)[number]

/**
 * Local adapter input for collision geometry until mc-kernel publishes block states.
 * Neighbor-derived connection and stair-corner values are supplied by the caller.
 */
export type BlockShapeStateInput =
  | Readonly<{ kind: 'slab'; half: BlockHalf | 'double' }>
  | Readonly<{ kind: 'stairs'; facing: BlockFacing; half: BlockHalf; shape: StairShape }>
  | Readonly<{ kind: 'fence'; north: boolean; east: boolean; south: boolean; west: boolean }>
  | Readonly<{
      kind: 'wall'
      north: WallConnection
      east: WallConnection
      south: WallConnection
      west: WallConnection
      up: boolean
    }>
  | Readonly<{ kind: 'door'; facing: BlockFacing; half: BlockHalf; hinge: 'left' | 'right'; open: boolean }>
  | Readonly<{ kind: 'trapdoor'; facing: BlockFacing; half: BlockHalf; open: boolean }>
  | Readonly<{ kind: 'bed'; facing: BlockFacing; part: 'head' | 'foot' }>
  | Readonly<{ kind: 'carpet' }>
  | Readonly<{ kind: 'snow'; layers: SnowLayerCount }>
  | Readonly<{ kind: 'soulSand' }>
  | Readonly<{ kind: 'cactus' }>
  | Readonly<{ kind: 'pressurePlate'; pressed: boolean }>

export type BlockShapeStateAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => BlockShapeStateInput | null

export type BlockShapeLookup = BlockShape | null | Result.Result<BlockShape | null, RangeError>

export type BlockShapeAt = (
  bx: BlockAxis,
  by: BlockAxis,
  bz: BlockAxis,
  state?: BlockShapeStateInput | null,
) => BlockShapeLookup
