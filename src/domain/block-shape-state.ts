import type { BlockAxis } from '@nerima-games/mc-kernel'
import type { BlockShape } from './coordinates.js'
import type { Result } from 'effect'

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

type NumericLiteralFromString<Value extends string> =
  Value extends `${infer NumericValue extends number}` ? NumericValue : never

export type BlockStateInteger = NumericLiteralFromString<
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' |
  '14' | '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22' | '23' | '24' | '25'
>
export type BlockStateAge = BlockStateInteger
export type BlockStateLevel = NumericLiteralFromString<
  '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15'
>
export type BlockStateDelay = NumericLiteralFromString<'1' | '2' | '3' | '4'>
export type BlockStateDistance = NumericLiteralFromString<'1' | '2' | '3' | '4' | '5' | '6' | '7'>
export type BlockStateLayers = (typeof SNOW_LAYER_COUNTS)[number]
export type BlockStateMoisture = NumericLiteralFromString<'0' | '1' | '2' | '3' | '4' | '5' | '6' | '7'>
export type BlockStatePower = BlockStateLevel
export type BlockStateRotation = BlockStateLevel
export type BlockStateStage = NumericLiteralFromString<'0' | '1'>

// Local K1-compatible state seam. Replace this alias with mc-kernel's
// BlockStateValues import when the dependency version contains the K1 API.
export type BlockStateValues = Readonly<{
  facing?: 'north' | 'east' | 'south' | 'west' | 'up' | 'down'
  half?: 'upper' | 'lower' | 'top' | 'bottom'
  hinge?: 'left' | 'right'
  open?: boolean
  age?: BlockStateAge
  level?: BlockStateLevel
  powered?: boolean
  delay?: BlockStateDelay
  shape?:
    | 'straight'
    | 'inner_left'
    | 'inner_right'
    | 'outer_left'
    | 'outer_right'
    | 'north_south'
    | 'east_west'
    | 'ascending_east'
    | 'ascending_west'
    | 'ascending_north'
    | 'ascending_south'
    | 'south_east'
    | 'south_west'
    | 'north_west'
    | 'north_east'
  connections?: Readonly<{
    down?: boolean | 'none' | 'side' | 'up'
    north?: boolean | 'none' | 'side' | 'up'
    east?: boolean | 'none' | 'side' | 'up'
    south?: boolean | 'none' | 'side' | 'up'
    west?: boolean | 'none' | 'side' | 'up'
    up?: boolean | 'none' | 'side' | 'up'
  }>
  axis?: 'x' | 'y' | 'z'
  distance?: BlockStateDistance
  enabled?: boolean
  extended?: boolean
  face?: 'floor' | 'wall' | 'ceiling'
  has_bottle_0?: boolean
  has_bottle_1?: boolean
  has_bottle_2?: boolean
  layers?: BlockStateLayers
  lit?: boolean
  locked?: boolean
  mode?: 'compare' | 'subtract'
  moisture?: BlockStateMoisture
  occupied?: boolean
  part?: 'head' | 'foot'
  persistent?: boolean
  power?: BlockStatePower
  rotation?: BlockStateRotation
  short?: boolean
  snowy?: boolean
  stage?: BlockStateStage
  triggered?: boolean
  type?: 'single' | 'left' | 'right' | 'top' | 'bottom' | 'double' | 'normal' | 'sticky'
  unstable?: boolean
  waterlogged?: boolean
}>

export type BlockStateFacing = NonNullable<BlockStateValues['facing']>
export type BlockStateHalf = NonNullable<BlockStateValues['half']>
export type BlockStateHinge = NonNullable<BlockStateValues['hinge']>
export type BlockStateShape = NonNullable<BlockStateValues['shape']>
export type BlockStatePart = NonNullable<BlockStateValues['part']>
export type BlockStateType = NonNullable<BlockStateValues['type']>
export type BlockStateConnections = NonNullable<BlockStateValues['connections']>
export type BlockStateConnectionValue = NonNullable<BlockStateConnections['north']>
export type BlockFacing = Extract<BlockStateFacing, 'north' | 'east' | 'south' | 'west'>
export type BlockHalf = Extract<BlockStateHalf, 'bottom' | 'top'>
export type DoorHalf = Extract<BlockStateHalf, 'lower' | 'upper'>
export type StairShape = Extract<
  BlockStateShape,
  'straight' | 'inner_left' | 'inner_right' | 'outer_left' | 'outer_right'
>
export type WallConnection = BlockStateConnectionValue
export type SnowLayerCount = BlockStateLayers

/** Local geometry discriminator with state property names and values from K1. */
export type BlockShapeStateInput =
  | Readonly<{ kind: 'slab'; type: Extract<BlockStateType, 'bottom' | 'top' | 'double'> }>
  | Readonly<{ kind: 'stairs'; facing: BlockFacing; half: BlockHalf; shape: StairShape }>
  | Readonly<{
      kind: 'fence'
      connections?: BlockStateConnections
    }>
  | Readonly<{
      kind: 'wall'
      connections?: BlockStateConnections
    }>
  | Readonly<{ kind: 'door'; facing: BlockFacing; half: DoorHalf; hinge: BlockStateHinge; open: boolean }>
  | Readonly<{ kind: 'trapdoor'; facing: BlockFacing; half: BlockHalf; open: boolean }>
  | Readonly<{ kind: 'bed'; facing: BlockFacing; part: BlockStatePart }>
  | Readonly<{ kind: 'carpet' }>
  | Readonly<{ kind: 'snow'; layers: BlockStateLayers }>
  | Readonly<{ kind: 'soulSand' }>
  | Readonly<{ kind: 'cactus' }>
  | Readonly<{ kind: 'pressurePlate'; powered: boolean }>

export type BlockShapeStateAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => BlockShapeStateInput | null

export type BlockShapeLookup = BlockShape | null | Result.Result<BlockShape | null, RangeError>

export type BlockShapeAt = (
  bx: BlockAxis,
  by: BlockAxis,
  bz: BlockAxis,
  state?: BlockShapeStateInput | null,
) => BlockShapeLookup
