import type { AABB, BlockShape } from './coordinates.js'
import {
  type BlockFacing,
  type BlockHalf,
  type BlockShapeLookup,
  type BlockStateConnectionValue,
  type BlockStateConnections,
  type BlockStateFacing,
  type BlockStateLookupFailure,
  type CustomBlockShapeStateInput,
  type StairShape,
  type WallConnection,
} from './block-shape-state.js'
import {
  BlockId,
  type BlockStateCodecFailure,
  type BlockType,
  type CollisionShape,
  type EffectiveBlockStateValues,
  type EncodedBlockState,
  PositionAxis,
  blockStateDefinitionOf,
  defaultBlockState,
  effectiveBlockStateOf,
  encodeBlockState,
  isEmpty,
} from '@nerima-games/mc-kernel'
import { Brand, Result } from 'effect'

const HALF_BLOCK = 0.5
const ONE_SIXTEENTH = 0.0625
const FIFTEEN_SIXTEENTHS = 0.9375
const PIXELS_PER_BLOCK = 16
const TWO_PIXELS = 2
const THREE_PIXELS = 3
const FOUR_PIXELS = 4
const FIVE_PIXELS = 5
const SIX_PIXELS = 6
const SEVEN_PIXELS = 7
const NINE_PIXELS = 9
const TEN_PIXELS = 10
const ELEVEN_PIXELS = 11
const TWELVE_PIXELS = 12
const THIRTEEN_PIXELS = 13
const FOURTEEN_PIXELS = 14
const TWENTY_FOUR_PIXELS = 24
const SNOW_LAYER_PIXELS = TWO_PIXELS
const TWO_SIXTEENTHS = TWO_PIXELS / PIXELS_PER_BLOCK
const THREE_SIXTEENTHS = THREE_PIXELS / PIXELS_PER_BLOCK
const FOUR_SIXTEENTHS = FOUR_PIXELS / PIXELS_PER_BLOCK
const FIVE_SIXTEENTHS = FIVE_PIXELS / PIXELS_PER_BLOCK
const SIX_SIXTEENTHS = SIX_PIXELS / PIXELS_PER_BLOCK
const SEVEN_SIXTEENTHS = SEVEN_PIXELS / PIXELS_PER_BLOCK
const TEN_SIXTEENTHS = TEN_PIXELS / PIXELS_PER_BLOCK
const ELEVEN_SIXTEENTHS = ELEVEN_PIXELS / PIXELS_PER_BLOCK
const TWELVE_SIXTEENTHS = TWELVE_PIXELS / PIXELS_PER_BLOCK
const THIRTEEN_SIXTEENTHS = THIRTEEN_PIXELS / PIXELS_PER_BLOCK
const FOURTEEN_SIXTEENTHS = FOURTEEN_PIXELS / PIXELS_PER_BLOCK
const TWENTY_FOUR_SIXTEENTHS = TWENTY_FOUR_PIXELS / PIXELS_PER_BLOCK
const WALL_ARM_HALF_WIDTH = THREE_PIXELS / PIXELS_PER_BLOCK
const NINE_SIXTEENTHS = NINE_PIXELS / PIXELS_PER_BLOCK
const HALF_PIXEL = HALF_BLOCK / PIXELS_PER_BLOCK
const PISTON_HEAD_LONG_ARM_END = 1 + FOUR_SIXTEENTHS
const PISTON_HEAD_LONG_ARM_START = -FOUR_SIXTEENTHS

const localBox = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB => ({
  maxX: PositionAxis(maxX),
  maxY: PositionAxis(maxY),
  maxZ: PositionAxis(maxZ),
  minX: PositionAxis(minX),
  minY: PositionAxis(minY),
  minZ: PositionAxis(minZ),
})

/** The shape a full block occupies within its own cell: the whole unit cube. */
export const FULL_BLOCK_SHAPE: AABB = {
  maxX: PositionAxis(1),
  maxY: PositionAxis(1),
  maxZ: PositionAxis(1),
  minX: PositionAxis(0),
  minY: PositionAxis(0),
  minZ: PositionAxis(0),
}

const DIRECTIONAL_HALF_SHAPES: Readonly<Record<BlockFacing, AABB>> = {
  east: localBox(HALF_BLOCK, 0, 0, 1, 1, 1),
  north: localBox(0, 0, 0, 1, 1, HALF_BLOCK),
  south: localBox(0, 0, HALF_BLOCK, 1, 1, 1),
  west: localBox(0, 0, 0, HALF_BLOCK, 1, 1),
}

const sixWayFacing = (facing: BlockStateFacing | undefined): facing is BlockStateFacing =>
  facing === 'north' || facing === 'east' || facing === 'south' || facing === 'west' || facing === 'up' || facing === 'down'
const horizontalFacing = (facing: BlockStateFacing | undefined): facing is BlockFacing =>
  facing === 'north' || facing === 'east' || facing === 'south' || facing === 'west'

const EXTENDED_PISTON_SHAPES_BY_FACING: Readonly<Record<BlockStateFacing, AABB>> = {
  down: localBox(0, FOUR_SIXTEENTHS, 0, 1, 1, 1),
  east: localBox(0, 0, 0, TWELVE_SIXTEENTHS, 1, 1),
  north: localBox(0, 0, FOUR_SIXTEENTHS, 1, 1, 1),
  south: localBox(0, 0, 0, 1, 1, TWELVE_SIXTEENTHS),
  up: localBox(0, 0, 0, 1, TWELVE_SIXTEENTHS, 1),
  west: localBox(FOUR_SIXTEENTHS, 0, 0, 1, 1, 1),
}

const pistonShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (typeof state.extended !== 'boolean' || !sixWayFacing(state.facing)) {
    return globalThis.undefined
  }
  if (!state.extended) {
    return FULL_BLOCK_SHAPE
  }
  return EXTENDED_PISTON_SHAPES_BY_FACING[state.facing]
}

const LADDER_SHAPES_BY_FACING: Readonly<Record<BlockFacing, AABB>> = {
  east: localBox(0, 0, 0, THREE_SIXTEENTHS, 1, 1),
  north: localBox(0, 0, THIRTEEN_SIXTEENTHS, 1, 1, 1),
  south: localBox(0, 0, 0, 1, 1, THREE_SIXTEENTHS),
  west: localBox(THIRTEEN_SIXTEENTHS, 0, 0, 1, 1, 1),
}

const ladderShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (!horizontalFacing(state.facing)) {
    return globalThis.undefined
  }
  return LADDER_SHAPES_BY_FACING[state.facing]
}

const AMETHYST_CLUSTER_SHAPES_BY_FACING: Readonly<Record<BlockStateFacing, AABB>> = {
  down: localBox(THREE_SIXTEENTHS, NINE_SIXTEENTHS, THREE_SIXTEENTHS, THIRTEEN_SIXTEENTHS, 1, THIRTEEN_SIXTEENTHS),
  east: localBox(0, THREE_SIXTEENTHS, THREE_SIXTEENTHS, SEVEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS),
  north: localBox(THREE_SIXTEENTHS, THREE_SIXTEENTHS, NINE_SIXTEENTHS, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS, 1),
  south: localBox(THREE_SIXTEENTHS, THREE_SIXTEENTHS, 0, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS, SEVEN_SIXTEENTHS),
  up: localBox(THREE_SIXTEENTHS, 0, THREE_SIXTEENTHS, THIRTEEN_SIXTEENTHS, SEVEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS),
  west: localBox(NINE_SIXTEENTHS, THREE_SIXTEENTHS, THREE_SIXTEENTHS, 1, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS),
}

const amethystClusterShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (!sixWayFacing(state.facing)) {
    return globalThis.undefined
  }
  return AMETHYST_CLUSTER_SHAPES_BY_FACING[state.facing]
}

type HopperFacing = Extract<BlockStateFacing, 'down' | 'north' | 'south' | 'west' | 'east'>
const HOPPER_SHAPES_BY_FACING: Readonly<Record<HopperFacing, ReadonlyArray<AABB>>> = {
  down: [
    localBox(SIX_SIXTEENTHS, 0, SIX_SIXTEENTHS, TEN_SIXTEENTHS, ELEVEN_SIXTEENTHS, TEN_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, SIX_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(SIX_SIXTEENTHS, FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, SIX_SIXTEENTHS),
    localBox(SIX_SIXTEENTHS, FOUR_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(TEN_SIXTEENTHS, FOUR_SIXTEENTHS, SIX_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, TEN_SIXTEENTHS),
    localBox(0, TEN_SIXTEENTHS, 0, FOUR_SIXTEENTHS, ELEVEN_SIXTEENTHS, 1),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, 0, 1, ELEVEN_SIXTEENTHS, FOUR_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, 1),
    localBox(TWELVE_SIXTEENTHS, TEN_SIXTEENTHS, FOUR_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(0, ELEVEN_SIXTEENTHS, 0, TWO_SIXTEENTHS, 1, 1),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, 0, 1, 1, TWO_SIXTEENTHS),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, 1, 1, 1),
    localBox(FOURTEEN_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWO_SIXTEENTHS, 1, 1, FOURTEEN_SIXTEENTHS),
  ],
  east: [
    localBox(FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(TWELVE_SIXTEENTHS, FOUR_SIXTEENTHS, SIX_SIXTEENTHS, 1, HALF_BLOCK, TEN_SIXTEENTHS),
    localBox(0, TEN_SIXTEENTHS, 0, FOUR_SIXTEENTHS, ELEVEN_SIXTEENTHS, 1),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, 0, 1, ELEVEN_SIXTEENTHS, FOUR_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, 1),
    localBox(TWELVE_SIXTEENTHS, TEN_SIXTEENTHS, FOUR_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(0, ELEVEN_SIXTEENTHS, 0, TWO_SIXTEENTHS, 1, 1),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, 0, 1, 1, TWO_SIXTEENTHS),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, 1, 1, 1),
    localBox(FOURTEEN_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWO_SIXTEENTHS, 1, 1, FOURTEEN_SIXTEENTHS),
  ],
  north: [
    localBox(FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(SIX_SIXTEENTHS, FOUR_SIXTEENTHS, 0, TEN_SIXTEENTHS, HALF_BLOCK, FOUR_SIXTEENTHS),
    localBox(0, TEN_SIXTEENTHS, 0, FOUR_SIXTEENTHS, ELEVEN_SIXTEENTHS, 1),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, 0, 1, ELEVEN_SIXTEENTHS, FOUR_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, 1),
    localBox(TWELVE_SIXTEENTHS, TEN_SIXTEENTHS, FOUR_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(0, ELEVEN_SIXTEENTHS, 0, TWO_SIXTEENTHS, 1, 1),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, 0, 1, 1, TWO_SIXTEENTHS),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, 1, 1, 1),
    localBox(FOURTEEN_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWO_SIXTEENTHS, 1, 1, FOURTEEN_SIXTEENTHS),
  ],
  south: [
    localBox(FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(SIX_SIXTEENTHS, FOUR_SIXTEENTHS, TWELVE_SIXTEENTHS, TEN_SIXTEENTHS, HALF_BLOCK, 1),
    localBox(0, TEN_SIXTEENTHS, 0, FOUR_SIXTEENTHS, ELEVEN_SIXTEENTHS, 1),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, 0, 1, ELEVEN_SIXTEENTHS, FOUR_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, 1),
    localBox(TWELVE_SIXTEENTHS, TEN_SIXTEENTHS, FOUR_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(0, ELEVEN_SIXTEENTHS, 0, TWO_SIXTEENTHS, 1, 1),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, 0, 1, 1, TWO_SIXTEENTHS),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, 1, 1, 1),
    localBox(FOURTEEN_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWO_SIXTEENTHS, 1, 1, FOURTEEN_SIXTEENTHS),
  ],
  west: [
    localBox(0, FOUR_SIXTEENTHS, SIX_SIXTEENTHS, TWELVE_SIXTEENTHS, HALF_BLOCK, TEN_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, SIX_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, HALF_BLOCK, SIX_SIXTEENTHS, TWELVE_SIXTEENTHS, ELEVEN_SIXTEENTHS, TEN_SIXTEENTHS),
    localBox(0, TEN_SIXTEENTHS, 0, FOUR_SIXTEENTHS, ELEVEN_SIXTEENTHS, 1),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, 0, 1, ELEVEN_SIXTEENTHS, FOUR_SIXTEENTHS),
    localBox(FOUR_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, 1),
    localBox(TWELVE_SIXTEENTHS, TEN_SIXTEENTHS, FOUR_SIXTEENTHS, 1, ELEVEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
    localBox(0, ELEVEN_SIXTEENTHS, 0, TWO_SIXTEENTHS, 1, 1),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, 0, 1, 1, TWO_SIXTEENTHS),
    localBox(TWO_SIXTEENTHS, ELEVEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, 1, 1, 1),
    localBox(FOURTEEN_SIXTEENTHS, ELEVEN_SIXTEENTHS, TWO_SIXTEENTHS, 1, 1, FOURTEEN_SIXTEENTHS),
  ],
}

const hopperShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (!state.facing || state.facing === 'up') {
    return globalThis.undefined
  }
  return HOPPER_SHAPES_BY_FACING[state.facing]
}

type PistonHeadShapeFactory = (longerEnd: number, shorterStart: number) => BlockShape
const PISTON_HEAD_SHAPES_BY_FACING: Readonly<Record<BlockStateFacing, PistonHeadShapeFactory>> = {
  down: (longerEnd) => [
    localBox(0, 0, 0, 1, FOUR_SIXTEENTHS, 1),
    localBox(SIX_SIXTEENTHS, FOUR_SIXTEENTHS, SIX_SIXTEENTHS, TEN_SIXTEENTHS, longerEnd, TEN_SIXTEENTHS),
  ],
  east: (_longerEnd, shorterStart) => [
    localBox(TWELVE_SIXTEENTHS, 0, 0, 1, 1, 1),
    localBox(shorterStart, SIX_SIXTEENTHS, SIX_SIXTEENTHS, TWELVE_SIXTEENTHS, TEN_SIXTEENTHS, TEN_SIXTEENTHS),
  ],
  north: (longerEnd) => [
    localBox(0, 0, 0, 1, 1, FOUR_SIXTEENTHS),
    localBox(SIX_SIXTEENTHS, SIX_SIXTEENTHS, FOUR_SIXTEENTHS, TEN_SIXTEENTHS, TEN_SIXTEENTHS, longerEnd),
  ],
  south: (_longerEnd, shorterStart) => [
    localBox(0, 0, TWELVE_SIXTEENTHS, 1, 1, 1),
    localBox(SIX_SIXTEENTHS, SIX_SIXTEENTHS, shorterStart, TEN_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS),
  ],
  up: (_longerEnd, shorterStart) => [
    localBox(0, TWELVE_SIXTEENTHS, 0, 1, 1, 1),
    localBox(SIX_SIXTEENTHS, shorterStart, SIX_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, TEN_SIXTEENTHS),
  ],
  west: (longerEnd) => [
    localBox(0, 0, 0, FOUR_SIXTEENTHS, 1, 1),
    localBox(FOUR_SIXTEENTHS, SIX_SIXTEENTHS, SIX_SIXTEENTHS, longerEnd, TEN_SIXTEENTHS, TEN_SIXTEENTHS),
  ],
}
const pistonHeadShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (!sixWayFacing(state.facing) || typeof state.short !== 'boolean' || (state.type !== 'normal' && state.type !== 'sticky')) {
    return globalThis.undefined
  }
  let longerEnd = 1
  let shorterStart = 0
  if (!state.short) {
    longerEnd = PISTON_HEAD_LONG_ARM_END
    shorterStart = PISTON_HEAD_LONG_ARM_START
  }
  return PISTON_HEAD_SHAPES_BY_FACING[state.facing](longerEnd, shorterStart)
}

const CHORUS_PLANT_CONNECTIONS = ['down', 'east', 'north', 'south', 'up', 'west'] as const
const chorusPlantShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  const { connections } = state
  if (typeof connections === 'undefined' || CHORUS_PLANT_CONNECTIONS.some((direction) => typeof connections[direction] !== 'boolean')) {
    return globalThis.undefined
  }
  const { down: downState, east: eastState, north: northState, south: southState, up: upState, west: westState } = connections
  let centerMinY = THREE_SIXTEENTHS
  let centerMaxY = THIRTEEN_SIXTEENTHS
  if (downState === true) {
    centerMinY = 0
  }
  if (upState === true) {
    centerMaxY = 1
  }
  const shapes: Array<AABB> = [localBox(THREE_SIXTEENTHS, centerMinY, THREE_SIXTEENTHS, THIRTEEN_SIXTEENTHS, centerMaxY, THIRTEEN_SIXTEENTHS)]
  if (northState === true) {
    shapes.push(localBox(THREE_SIXTEENTHS, THREE_SIXTEENTHS, 0, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS, THREE_SIXTEENTHS))
  }
  if (eastState === true) {
    shapes.push(localBox(THIRTEEN_SIXTEENTHS, THREE_SIXTEENTHS, THREE_SIXTEENTHS, 1, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS))
  }
  if (southState === true) {
    shapes.push(localBox(THREE_SIXTEENTHS, THREE_SIXTEENTHS, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS, 1))
  }
  if (westState === true) {
    shapes.push(localBox(0, THREE_SIXTEENTHS, THREE_SIXTEENTHS, THREE_SIXTEENTHS, THIRTEEN_SIXTEENTHS, THIRTEEN_SIXTEENTHS))
  }
  return shapes
}

const END_ROD_SHAPES_BY_AXIS: Readonly<Record<'x' | 'y' | 'z', AABB>> = {
  x: localBox(0, SIX_SIXTEENTHS, SIX_SIXTEENTHS, 1, TEN_SIXTEENTHS, TEN_SIXTEENTHS),
  y: localBox(SIX_SIXTEENTHS, 0, SIX_SIXTEENTHS, TEN_SIXTEENTHS, 1, TEN_SIXTEENTHS),
  z: localBox(SIX_SIXTEENTHS, SIX_SIXTEENTHS, 0, TEN_SIXTEENTHS, TEN_SIXTEENTHS, 1),
}
const endRodShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (!sixWayFacing(state.facing)) {
    return globalThis.undefined
  }
  if (state.facing === 'east' || state.facing === 'west') {
    return END_ROD_SHAPES_BY_AXIS.x
  }
  if (state.facing === 'up' || state.facing === 'down') {
    return END_ROD_SHAPES_BY_AXIS.y
  }
  return END_ROD_SHAPES_BY_AXIS.z
}

const CHEST_SHAPES_BY_FACING: Readonly<Record<BlockFacing, Readonly<Record<'single' | 'left' | 'right', AABB>>>> = {
  east: {
    left: localBox(ONE_SIXTEENTH, 0, ONE_SIXTEENTH, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, 1),
    right: localBox(ONE_SIXTEENTH, 0, 0, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
    single: localBox(ONE_SIXTEENTH, 0, ONE_SIXTEENTH, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
  },
  north: {
    left: localBox(ONE_SIXTEENTH, 0, ONE_SIXTEENTH, 1, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
    right: localBox(0, 0, ONE_SIXTEENTH, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
    single: localBox(ONE_SIXTEENTH, 0, ONE_SIXTEENTH, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
  },
  south: {
    left: localBox(0, 0, ONE_SIXTEENTH, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
    right: localBox(ONE_SIXTEENTH, 0, ONE_SIXTEENTH, 1, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
    single: localBox(ONE_SIXTEENTH, 0, ONE_SIXTEENTH, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
  },
  west: {
    left: localBox(ONE_SIXTEENTH, 0, 0, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
    right: localBox(ONE_SIXTEENTH, 0, ONE_SIXTEENTH, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, 1),
    single: localBox(ONE_SIXTEENTH, 0, ONE_SIXTEENTH, FIFTEEN_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FIFTEEN_SIXTEENTHS),
  },
}
const chestShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (!horizontalFacing(state.facing)) {
    return globalThis.undefined
  }
  if (state.type !== 'single' && state.type !== 'left' && state.type !== 'right') {
    return globalThis.undefined
  }
  return CHEST_SHAPES_BY_FACING[state.facing][state.type]
}

const ANVIL_NORTH_SOUTH_SHAPES: ReadonlyArray<AABB> = [
  localBox(TWO_SIXTEENTHS, 0, TWO_SIXTEENTHS, FOURTEEN_SIXTEENTHS, FOUR_SIXTEENTHS, FOURTEEN_SIXTEENTHS),
  localBox(FOUR_SIXTEENTHS, FOUR_SIXTEENTHS, THREE_SIXTEENTHS, TWELVE_SIXTEENTHS, FIVE_SIXTEENTHS, THIRTEEN_SIXTEENTHS),
  localBox(SIX_SIXTEENTHS, FIVE_SIXTEENTHS, FOUR_SIXTEENTHS, TEN_SIXTEENTHS, 1, TWELVE_SIXTEENTHS),
  localBox(THREE_SIXTEENTHS, TEN_SIXTEENTHS, 0, SIX_SIXTEENTHS, 1, 1),
  localBox(SIX_SIXTEENTHS, TEN_SIXTEENTHS, 0, THIRTEEN_SIXTEENTHS, 1, FOUR_SIXTEENTHS),
  localBox(SIX_SIXTEENTHS, TEN_SIXTEENTHS, TWELVE_SIXTEENTHS, THIRTEEN_SIXTEENTHS, 1, 1),
  localBox(TEN_SIXTEENTHS, TEN_SIXTEENTHS, FOUR_SIXTEENTHS, THIRTEEN_SIXTEENTHS, 1, TWELVE_SIXTEENTHS),
]
const anvilShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (!horizontalFacing(state.facing)) {
    return globalThis.undefined
  }
  if (state.facing === 'north' || state.facing === 'south') {
    return ANVIL_NORTH_SOUTH_SHAPES
  }
  return ANVIL_NORTH_SOUTH_SHAPES.map((shape) => localBox(
    1 - Number(shape.maxZ), Number(shape.minY), Number(shape.minX),
    1 - Number(shape.minZ), Number(shape.maxY), Number(shape.maxX),
  ))
}

/** A bottom slab: the lower eight pixels of its cell. */
export const SLAB_SHAPE: AABB = { ...FULL_BLOCK_SHAPE, maxY: PositionAxis(HALF_BLOCK) }

/** An unpressed pressure plate: inset one pixel and one pixel high. */
export const PRESSURE_PLATE_SHAPE: AABB = {
  maxX: PositionAxis(FIFTEEN_SIXTEENTHS),
  maxY: PositionAxis(ONE_SIXTEENTH),
  maxZ: PositionAxis(FIFTEEN_SIXTEENTHS),
  minX: PositionAxis(ONE_SIXTEENTH),
  minY: PositionAxis(0),
  minZ: PositionAxis(ONE_SIXTEENTH),
}

/** A cactus: 14 pixels wide, 15 pixels tall, inset one pixel on each horizontal side. */
export const CACTUS_SHAPE: AABB = {
  ...FULL_BLOCK_SHAPE,
  maxX: PositionAxis(FIFTEEN_SIXTEENTHS),
  maxY: PositionAxis(FIFTEEN_SIXTEENTHS),
  maxZ: PositionAxis(FIFTEEN_SIXTEENTHS),
  minX: PositionAxis(ONE_SIXTEENTH),
  minZ: PositionAxis(ONE_SIXTEENTH),
}

const Y_RANGE_BY_HALF: Readonly<Record<BlockHalf, readonly [number, number]>> = {
  bottom: [0, HALF_BLOCK],
  top: [HALF_BLOCK, 1],
}
const yRangeForHalf = (half: BlockHalf): readonly [number, number] => Y_RANGE_BY_HALF[half]

const fullHorizontalBox = (minY: number, maxY: number): AABB => localBox(0, minY, 0, 1, maxY, 1)

const directionalHalf = (facing: BlockFacing): AABB => DIRECTIONAL_HALF_SHAPES[facing]

const sideHalf = (facing: BlockFacing, side: 'left' | 'right'): AABB => {
  const leftFacing: Readonly<Record<BlockFacing, BlockFacing>> = {
    east: 'north',
    north: 'west',
    south: 'east',
    west: 'south',
  }
  const rightFacing: Readonly<Record<BlockFacing, BlockFacing>> = {
    east: 'south',
    north: 'east',
    south: 'west',
    west: 'north',
  }
  const facingBySide = { left: leftFacing, right: rightFacing }
  return directionalHalf(facingBySide[side][facing])
}

const intersectHorizontal = (a: AABB, b: AABB, minY: number, maxY: number): AABB => localBox(
  Math.max(a.minX, b.minX),
  minY,
  Math.max(a.minZ, b.minZ),
  Math.min(a.maxX, b.maxX),
  maxY,
  Math.min(a.maxZ, b.maxZ),
)

const stairShapes = (facing: BlockFacing, half: BlockHalf, shape: StairShape): ReadonlyArray<AABB> => {
  const [baseMinY, baseMaxY] = yRangeForHalf(half)
  const oppositeHalf: Readonly<Record<BlockHalf, BlockHalf>> = { bottom: 'top', top: 'bottom' }
  const [stepMinY, stepMaxY] = yRangeForHalf(oppositeHalf[half])
  const base = fullHorizontalBox(baseMinY, baseMaxY)
  const facingShape = directionalHalf(facing)
  const facingBox = localBox(facingShape.minX, stepMinY, facingShape.minZ, facingShape.maxX, stepMaxY, facingShape.maxZ)
  if (shape === 'straight') {
    return [base, facingBox]
  }
  let side: AABB
  if (shape === 'inner_left' || shape === 'outer_left') {
    side = sideHalf(facing, 'left')
  } else {
    side = sideHalf(facing, 'right')
  }
  if (shape === 'outer_left' || shape === 'outer_right') {
    return [base, intersectHorizontal(facingShape, side, stepMinY, stepMaxY)]
  }
  const sideBox = localBox(side.minX, stepMinY, side.minZ, side.maxX, stepMaxY, side.maxZ)
  return [base, facingBox, sideBox]
}

const wallConnectionIsPresent = (connection: BlockStateConnectionValue | undefined): boolean =>
  typeof connection !== 'undefined' && connection !== false && connection !== 'none'

const fenceShapes = (connections: BlockStateConnections | undefined): ReadonlyArray<AABB> => {
  const post = localBox(SIX_SIXTEENTHS, 0, SIX_SIXTEENTHS, TEN_SIXTEENTHS, TWENTY_FOUR_SIXTEENTHS, TEN_SIXTEENTHS)
  const shapes: Array<AABB> = [post]
  if (wallConnectionIsPresent(connections?.north)) {
    shapes.push(localBox(SIX_SIXTEENTHS, 0, 0, TEN_SIXTEENTHS, TWENTY_FOUR_SIXTEENTHS, HALF_BLOCK))
  }
  if (wallConnectionIsPresent(connections?.south)) {
    shapes.push(localBox(SIX_SIXTEENTHS, 0, HALF_BLOCK, TEN_SIXTEENTHS, TWENTY_FOUR_SIXTEENTHS, 1))
  }
  if (wallConnectionIsPresent(connections?.east)) {
    shapes.push(localBox(HALF_BLOCK, 0, SIX_SIXTEENTHS, 1, TWENTY_FOUR_SIXTEENTHS, TEN_SIXTEENTHS))
  }
  if (wallConnectionIsPresent(connections?.west)) {
    shapes.push(localBox(0, 0, SIX_SIXTEENTHS, HALF_BLOCK, TWENTY_FOUR_SIXTEENTHS, TEN_SIXTEENTHS))
  }
  return shapes
}

const wallShapes = (connections: BlockStateConnections | undefined): ReadonlyArray<AABB> => {
  const shapes: Array<AABB> = []
  const centerMin = FOUR_PIXELS / PIXELS_PER_BLOCK
  const centerMax = TWELVE_PIXELS / PIXELS_PER_BLOCK
  const armMin = HALF_BLOCK - WALL_ARM_HALF_WIDTH
  const armMax = HALF_BLOCK + WALL_ARM_HALF_WIDTH
  const armHeight = TWENTY_FOUR_SIXTEENTHS
  if (wallConnectionIsPresent(connections?.up)) {
    shapes.push(localBox(centerMin, 0, centerMin, centerMax, TWENTY_FOUR_SIXTEENTHS, centerMax))
  }
  if (wallConnectionIsPresent(connections?.north)) {
    shapes.push(localBox(armMin, 0, 0, armMax, armHeight, armMax))
  }
  if (wallConnectionIsPresent(connections?.south)) {
    shapes.push(localBox(armMin, 0, armMin, armMax, armHeight, 1))
  }
  if (wallConnectionIsPresent(connections?.east)) {
    shapes.push(localBox(armMin, 0, armMin, 1, armHeight, armMax))
  }
  if (wallConnectionIsPresent(connections?.west)) {
    shapes.push(localBox(0, 0, armMin, armMax, armHeight, armMax))
  }
  return shapes
}

const DOOR_SHAPES_BY_FACING: Readonly<Record<BlockFacing, AABB>> = {
  east: localBox(1 - THREE_SIXTEENTHS, 0, 0, 1, 1, 1),
  north: localBox(0, 0, 0, 1, 1, THREE_SIXTEENTHS),
  south: localBox(0, 0, 1 - THREE_SIXTEENTHS, 1, 1, 1),
  west: localBox(0, 0, 0, THREE_SIXTEENTHS, 1, 1),
}
const OPPOSITE_FACING: Readonly<Record<BlockFacing, BlockFacing>> = {
  east: 'west',
  north: 'south',
  south: 'north',
  west: 'east',
}
const closedDoor = (facing: BlockFacing): AABB => DOOR_SHAPES_BY_FACING[OPPOSITE_FACING[facing]]

const openedDoor = (facing: BlockFacing, hinge: 'left' | 'right'): AABB => {
  const leftEdge: Readonly<Record<BlockFacing, BlockFacing>> = {
    east: 'north',
    north: 'west',
    south: 'east',
    west: 'south',
  }
  const rightEdge: Readonly<Record<BlockFacing, BlockFacing>> = {
    east: 'south',
    north: 'east',
    south: 'west',
    west: 'north',
  }
  const edgeByHinge = { left: leftEdge, right: rightEdge }
  return DOOR_SHAPES_BY_FACING[edgeByHinge[hinge][facing]]
}

const CLOSED_TRAPDOOR_SHAPES: Readonly<Record<BlockHalf, AABB>> = {
  bottom: localBox(0, 0, 0, 1, THREE_SIXTEENTHS, 1),
  top: localBox(0, 1 - THREE_SIXTEENTHS, 0, 1, 1, 1),
}
const trapdoorShape = (facing: BlockFacing, half: BlockHalf, open: boolean): AABB => {
  if (!open) {
    return CLOSED_TRAPDOOR_SHAPES[half]
  }
  return DOOR_SHAPES_BY_FACING[OPPOSITE_FACING[facing]]
}

const BED_TOP = localBox(0, THREE_SIXTEENTHS, 0, 1, NINE_SIXTEENTHS, 1)
const BED_LEGS_BY_FACING: Readonly<Record<BlockFacing, ReadonlyArray<AABB>>> = {
  east: [
    localBox(1 - THREE_SIXTEENTHS, 0, 0, 1, THREE_SIXTEENTHS, THREE_SIXTEENTHS),
    localBox(1 - THREE_SIXTEENTHS, 0, 1 - THREE_SIXTEENTHS, 1, THREE_SIXTEENTHS, 1),
  ],
  north: [
    localBox(0, 0, 0, THREE_SIXTEENTHS, THREE_SIXTEENTHS, THREE_SIXTEENTHS),
    localBox(1 - THREE_SIXTEENTHS, 0, 0, 1, THREE_SIXTEENTHS, THREE_SIXTEENTHS),
  ],
  south: [
    localBox(0, 0, 1 - THREE_SIXTEENTHS, THREE_SIXTEENTHS, THREE_SIXTEENTHS, 1),
    localBox(1 - THREE_SIXTEENTHS, 0, 1 - THREE_SIXTEENTHS, 1, THREE_SIXTEENTHS, 1),
  ],
  west: [
    localBox(0, 0, 0, THREE_SIXTEENTHS, THREE_SIXTEENTHS, THREE_SIXTEENTHS),
    localBox(0, 0, 1 - THREE_SIXTEENTHS, THREE_SIXTEENTHS, THREE_SIXTEENTHS, 1),
  ],
}
const bedLegFacing = (facing: BlockFacing, part: 'head' | 'foot'): BlockFacing => {
  if (part === 'head') {
    return facing
  }
  return OPPOSITE_FACING[facing]
}
const bedShapes = (facing: BlockFacing, part: 'head' | 'foot'): ReadonlyArray<AABB> => [
  BED_TOP,
  ...BED_LEGS_BY_FACING[bedLegFacing(facing, part)],
]

const pressurePlateHeight = (powered: boolean): number => {
  if (powered) {
    return HALF_PIXEL
  }
  return ONE_SIXTEENTH
}
const pressurePlateShape = (powered: boolean): AABB => localBox(
  ONE_SIXTEENTH,
  0,
  ONE_SIXTEENTH,
  FIFTEEN_SIXTEENTHS,
  pressurePlateHeight(powered),
  FIFTEEN_SIXTEENTHS,
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isBlockFacing = (value: unknown): value is BlockFacing =>
  value === 'north' || value === 'east' || value === 'south' || value === 'west'

const isBlockHalf = (value: unknown): value is BlockHalf =>
  value === 'bottom' || value === 'top'

const isWallConnection = (value: unknown): value is WallConnection =>
  typeof value === 'boolean' || value === 'none' || value === 'side' || value === 'up'

const BLOCK_STATE_CONNECTION_KEYS: ReadonlyArray<keyof BlockStateConnections> = [
  'down',
  'north',
  'east',
  'south',
  'west',
  'up',
]

const isBlockStateConnections = (value: unknown): value is BlockStateConnections =>
  isRecord(value) &&
  Object.keys(value).every((key) => BLOCK_STATE_CONNECTION_KEYS.some((direction) => direction === key)) &&
  BLOCK_STATE_CONNECTION_KEYS.every((direction) =>
    typeof value[direction] === 'undefined' || isWallConnection(value[direction]))

const isOptionalBlockStateConnections = (value: unknown): value is BlockStateConnections | undefined =>
  typeof value === 'undefined' || isBlockStateConnections(value)

const isTrapdoorInput = (state: Record<string, unknown>): boolean =>
  isBlockFacing(state['facing']) && isBlockHalf(state['half']) && typeof state['open'] === 'boolean'

const isCustomBlockShapeStateInput = (value: unknown): value is CustomBlockShapeStateInput => {
  if (!isRecord(value)) {
    return false
  }
  switch (value['kind']) {
    case 'fence':
    case 'wall':
      return isOptionalBlockStateConnections(value['connections'])
    case 'trapdoor':
      return isTrapdoorInput(value)
    case 'carpet':
    case 'soulSand':
      return true
    default:
      return false
  }
}

export type KernelBlockState = Readonly<{
  readonly blockType: BlockType
  readonly values: EffectiveBlockStateValues
}>

type KernelBlockStateFailure = BlockStateCodecFailure | Brand.BrandError | BlockStateLookupFailure

/** Resolves state by block id so geometry cannot be selected by a caller-supplied kind. */
export const kernelBlockStateForCell = (
  rawBlockId: unknown,
  encodedState: EncodedBlockState | undefined,
): Result.Result<KernelBlockState | null, KernelBlockStateFailure> => {
  if (typeof rawBlockId === 'undefined') {
    return Result.fail({ _tag: 'BlockStateLookupFailure', reason: 'missing-block-id' })
  }
  if (rawBlockId === null) {
    if (typeof encodedState !== 'undefined') {
      return Result.fail({ _tag: 'BlockStateLookupFailure', reason: 'missing-block-id' })
    }
    return Result.succeed(null)
  }
  let numericBlockId: number
  if (typeof rawBlockId === 'number') {
    numericBlockId = rawBlockId
  } else {
    numericBlockId = Number.NaN
  }
  return Result.flatMap(BlockId.result(numericBlockId), (blockId): Result.Result<KernelBlockState | null, KernelBlockStateFailure> => {
    if (isEmpty(blockId)) {
      if (typeof encodedState !== 'undefined') {
        return Result.fail({ _tag: 'BlockStateLookupFailure', reason: 'missing-block-id' })
      }
      return Result.succeed(null)
    }
    return Result.flatMap(blockStateDefinitionOf(blockId), (definition): Result.Result<KernelBlockState, KernelBlockStateFailure> => {
      const encoded: Result.Result<EncodedBlockState, BlockStateCodecFailure> = (() => {
        if (typeof encodedState === 'undefined') {
          return Result.flatMap(defaultBlockState(blockId), (defaultState) => encodeBlockState(blockId, defaultState))
        }
        return Result.succeed(encodedState)
      })()
      return Result.map(Result.flatMap(encoded, (value) => effectiveBlockStateOf(blockId, value)), (values) => ({
        blockType: definition.blockType,
        values,
      }))
    })
  })
}

const slabShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (state.type === 'double') {
    return FULL_BLOCK_SHAPE
  }
  if (state.type === 'bottom') {
    return SLAB_SHAPE
  }
  if (state.type === 'top') {
    return { ...FULL_BLOCK_SHAPE, minY: PositionAxis(HALF_BLOCK) }
  }
  return globalThis.undefined
}

const stairShapeForState = (state: EffectiveBlockStateValues): ReadonlyArray<AABB> | undefined => {
  if (
    state.facing && isBlockFacing(state.facing) && state.half && isBlockHalf(state.half) &&
    state.shape && (state.shape === 'straight' || state.shape === 'inner_left' || state.shape === 'inner_right' || state.shape === 'outer_left' || state.shape === 'outer_right')
  ) {
    return stairShapes(state.facing, state.half, state.shape)
  }
  return globalThis.undefined
}

const doorShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (state.facing && isBlockFacing(state.facing) && state.hinge && (state.hinge === 'left' || state.hinge === 'right')) {
    if (state.open === true) {
      return openedDoor(state.facing, state.hinge)
    }
    return closedDoor(state.facing)
  }
  return globalThis.undefined
}

const bedShapeForState = (state: EffectiveBlockStateValues): ReadonlyArray<AABB> | undefined => {
  if (state.facing && isBlockFacing(state.facing) && (state.part === 'head' || state.part === 'foot')) {
    return bedShapes(state.facing, state.part)
  }
  return globalThis.undefined
}

const snowShapeForState = (state: EffectiveBlockStateValues): BlockShape | null | undefined => {
  if (typeof state.layers === 'undefined') {
    return globalThis.undefined
  }
  if (state.layers === 1) {
    return null
  }
  return fullHorizontalBox(0, ((state.layers - 1) * SNOW_LAYER_PIXELS) / PIXELS_PER_BLOCK)
}

const pressurePlateShapeForState = (state: EffectiveBlockStateValues): BlockShape | undefined => {
  if (typeof state.powered === 'boolean') {
    return pressurePlateShape(state.powered)
  }
  return globalThis.undefined
}

/** Selects state-dependent geometry from kernel-validated values; undefined uses the static collision shape. */
export const blockShapeForKernelState = (
  blockType: BlockType,
  state: EffectiveBlockStateValues,
): BlockShape | null | undefined => {
  switch (blockType) {
    case 'piston':
    case 'sticky_piston':
      return pistonShapeForState(state)
    case 'redstone_torch':
    case 'redstone_wall_torch':
      return null
    case 'ladder':
      return ladderShapeForState(state)
    case 'amethyst_cluster':
      return amethystClusterShapeForState(state)
    case 'hopper':
      return hopperShapeForState(state)
    case 'piston_head':
      return pistonHeadShapeForState(state)
    case 'chorus_plant':
      return chorusPlantShapeForState(state)
    case 'end_rod':
      return endRodShapeForState(state)
    case 'chest':
      return chestShapeForState(state)
    case 'anvil':
      return anvilShapeForState(state)
    case 'stone_slab':
    case 'purpur_slab':
      return slabShapeForState(state)
    case 'oak_stairs':
    case 'purpur_stairs':
      return stairShapeForState(state)
    case 'door':
    case 'door_open':
      return doorShapeForState(state)
    case 'bed':
      return bedShapeForState(state)
    case 'snow':
      return snowShapeForState(state)
    case 'pressure_plate':
      return pressurePlateShapeForState(state)
    default:
      return globalThis.undefined
  }
}

/** Resolves the PH1 custom geometries that have no kernel block-state definition. */
export const blockShapeForCustomState = (input: unknown): Result.Result<BlockShape | null, RangeError> => {
  if (!isCustomBlockShapeStateInput(input)) {
    return Result.fail(new RangeError('custom block shape state is invalid'))
  }
  switch (input.kind) {
    case 'fence': return Result.succeed(fenceShapes(input.connections))
    case 'wall': return Result.succeed(wallShapes(input.connections))
    case 'trapdoor': return Result.succeed(trapdoorShape(input.facing, input.half, input.open))
    case 'carpet': return Result.succeed(fullHorizontalBox(0, ONE_SIXTEENTH))
    case 'soulSand': return Result.succeed(fullHorizontalBox(0, FOURTEEN_SIXTEENTHS))
    default: return Result.fail(new RangeError('custom block shape state is invalid'))
  }
}

/** Adapts either a raw custom shape or a typed shape failure to the Result channel. */
const isShapeLookupResult = (
  lookup: BlockShapeLookup,
): lookup is Result.Result<BlockShape | null, RangeError> =>
  typeof lookup === 'object' && lookup !== null && ('success' in lookup || 'failure' in lookup)

export const blockShapeLookupResult = (lookup: BlockShapeLookup): Result.Result<BlockShape | null, RangeError> => {
  if (isShapeLookupResult(lookup)) {
    if (Result.isFailure(lookup)) {
      return Result.fail(lookup.failure)
    }
    return Result.succeed(lookup.success)
  }
  return Result.succeed(lookup)
}

export const COLLISION_SHAPE_AABBS: Readonly<Record<CollisionShape, AABB | null>> = {
  cactus: CACTUS_SHAPE,
  full: FULL_BLOCK_SHAPE,
  none: null,
  pressurePlate: PRESSURE_PLATE_SHAPE,
  slab: SLAB_SHAPE,
}
