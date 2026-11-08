import type { AABB, BlockShape } from './coordinates.js'
import {
  type BlockFacing,
  type BlockHalf,
  type BlockShapeLookup,
  type BlockShapeStateInput,
  type BlockStateConnectionValue,
  type BlockStateConnections,
  type DoorHalf,
  SNOW_LAYER_COUNTS,
  type SnowLayerCount,
  type StairShape,
  type WallConnection,
} from './block-shape-state.js'
import { type CollisionShape, PositionAxis } from '@nerima-games/mc-kernel'
import { Result } from 'effect'

const HALF_BLOCK = 0.5
const ONE_SIXTEENTH = 0.0625
const FIFTEEN_SIXTEENTHS = 0.9375
const PIXELS_PER_BLOCK = 16
const TWO_PIXELS = 2
const THREE_PIXELS = 3
const SIX_PIXELS = 6
const NINE_PIXELS = 9
const TEN_PIXELS = 10
const FOURTEEN_PIXELS = 14
const TWENTY_FOUR_PIXELS = 24
const SNOW_LAYER_PIXELS = TWO_PIXELS
const THREE_SIXTEENTHS = THREE_PIXELS / PIXELS_PER_BLOCK
const SIX_SIXTEENTHS = SIX_PIXELS / PIXELS_PER_BLOCK
const TEN_SIXTEENTHS = TEN_PIXELS / PIXELS_PER_BLOCK
const FOURTEEN_SIXTEENTHS = FOURTEEN_PIXELS / PIXELS_PER_BLOCK
const TWENTY_FOUR_SIXTEENTHS = TWENTY_FOUR_PIXELS / PIXELS_PER_BLOCK
const WALL_ARM_HALF_WIDTH = THREE_PIXELS / PIXELS_PER_BLOCK
const NINE_SIXTEENTHS = NINE_PIXELS / PIXELS_PER_BLOCK
const HALF_PIXEL = HALF_BLOCK / PIXELS_PER_BLOCK

/** The shape a full block occupies within its own cell: the whole unit cube. */
export const FULL_BLOCK_SHAPE: AABB = {
  maxX: PositionAxis(1),
  maxY: PositionAxis(1),
  maxZ: PositionAxis(1),
  minX: PositionAxis(0),
  minY: PositionAxis(0),
  minZ: PositionAxis(0),
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

const localBox = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB => ({
  maxX: PositionAxis(maxX),
  maxY: PositionAxis(maxY),
  maxZ: PositionAxis(maxZ),
  minX: PositionAxis(minX),
  minY: PositionAxis(minY),
  minZ: PositionAxis(minZ),
})

const Y_RANGE_BY_HALF: Readonly<Record<BlockHalf, readonly [number, number]>> = {
  bottom: [0, HALF_BLOCK],
  top: [HALF_BLOCK, 1],
}
const yRangeForHalf = (half: BlockHalf): readonly [number, number] => Y_RANGE_BY_HALF[half]

const fullHorizontalBox = (minY: number, maxY: number): AABB => localBox(0, minY, 0, 1, maxY, 1)

const DIRECTIONAL_HALF_SHAPES: Readonly<Record<BlockFacing, AABB>> = {
  east: localBox(HALF_BLOCK, 0, 0, 1, 1, 1),
  north: localBox(0, 0, 0, 1, 1, HALF_BLOCK),
  south: localBox(0, 0, HALF_BLOCK, 1, 1, 1),
  west: localBox(0, 0, 0, HALF_BLOCK, 1, 1),
}
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

const stairShapes = (state: Extract<BlockShapeStateInput, { kind: 'stairs' }>): ReadonlyArray<AABB> => {
  const [baseMinY, baseMaxY] = yRangeForHalf(state.half)
  const oppositeHalf: Readonly<Record<BlockHalf, BlockHalf>> = { bottom: 'top', top: 'bottom' }
  const [stepMinY, stepMaxY] = yRangeForHalf(oppositeHalf[state.half])
  const base = fullHorizontalBox(baseMinY, baseMaxY)
  const facing = directionalHalf(state.facing)
  const facingBox = localBox(facing.minX, stepMinY, facing.minZ, facing.maxX, stepMaxY, facing.maxZ)
  if (state.shape === 'straight') {
    return [base, facingBox]
  }
  let side: AABB
  if (state.shape === 'inner_left' || state.shape === 'outer_left') {
    side = sideHalf(state.facing, 'left')
  } else {
    side = sideHalf(state.facing, 'right')
  }
  if (state.shape === 'outer_left' || state.shape === 'outer_right') {
    return [base, intersectHorizontal(facing, side, stepMinY, stepMaxY)]
  }
  const sideBox = localBox(side.minX, stepMinY, side.minZ, side.maxX, stepMaxY, side.maxZ)
  return [base, facingBox, sideBox]
}

const wallConnectionIsPresent = (connection: BlockStateConnectionValue | undefined): boolean =>
  typeof connection !== 'undefined' && connection !== false && connection !== 'none'

const fenceShapes = (state: Extract<BlockShapeStateInput, { kind: 'fence' }>): ReadonlyArray<AABB> => {
  const post = localBox(SIX_SIXTEENTHS, 0, SIX_SIXTEENTHS, TEN_SIXTEENTHS, TWENTY_FOUR_SIXTEENTHS, TEN_SIXTEENTHS)
  const shapes: Array<AABB> = [post]
  if (wallConnectionIsPresent(state.connections?.north)) {
    shapes.push(localBox(SIX_SIXTEENTHS, 0, 0, TEN_SIXTEENTHS, TWENTY_FOUR_SIXTEENTHS, HALF_BLOCK))
  }
  if (wallConnectionIsPresent(state.connections?.south)) {
    shapes.push(localBox(SIX_SIXTEENTHS, 0, HALF_BLOCK, TEN_SIXTEENTHS, TWENTY_FOUR_SIXTEENTHS, 1))
  }
  if (wallConnectionIsPresent(state.connections?.east)) {
    shapes.push(localBox(HALF_BLOCK, 0, SIX_SIXTEENTHS, 1, TWENTY_FOUR_SIXTEENTHS, TEN_SIXTEENTHS))
  }
  if (wallConnectionIsPresent(state.connections?.west)) {
    shapes.push(localBox(0, 0, SIX_SIXTEENTHS, HALF_BLOCK, TWENTY_FOUR_SIXTEENTHS, TEN_SIXTEENTHS))
  }
  return shapes
}

const wallShapes = (state: Extract<BlockShapeStateInput, { kind: 'wall' }>): ReadonlyArray<AABB> => {
  const shapes: Array<AABB> = []
  const FOUR_PIXELS = 4
  const TWELVE_PIXELS = 12
  const centerMin = FOUR_PIXELS / PIXELS_PER_BLOCK
  const centerMax = TWELVE_PIXELS / PIXELS_PER_BLOCK
  const armMin = HALF_BLOCK - WALL_ARM_HALF_WIDTH
  const armMax = HALF_BLOCK + WALL_ARM_HALF_WIDTH
  const armHeight = TWENTY_FOUR_SIXTEENTHS
  if (wallConnectionIsPresent(state.connections?.up)) {
    shapes.push(localBox(centerMin, 0, centerMin, centerMax, TWENTY_FOUR_SIXTEENTHS, centerMax))
  }
  if (wallConnectionIsPresent(state.connections?.north)) {
    shapes.push(localBox(armMin, 0, 0, armMax, armHeight, armMax))
  }
  if (wallConnectionIsPresent(state.connections?.south)) {
    shapes.push(localBox(armMin, 0, armMin, armMax, armHeight, 1))
  }
  if (wallConnectionIsPresent(state.connections?.east)) {
    shapes.push(localBox(armMin, 0, armMin, 1, armHeight, armMax))
  }
  if (wallConnectionIsPresent(state.connections?.west)) {
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

const isStairShape = (value: unknown): value is StairShape =>
  value === 'straight' || value === 'inner_left' || value === 'inner_right' || value === 'outer_left' || value === 'outer_right'

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

const isSnowLayerCount = (value: unknown): value is SnowLayerCount =>
  SNOW_LAYER_COUNTS.some((layer) => layer === value)

const isSlabInput = (state: Record<string, unknown>): boolean =>
  state['type'] === 'bottom' || state['type'] === 'top' || state['type'] === 'double'

const isStairsInput = (state: Record<string, unknown>): boolean =>
  isBlockFacing(state['facing']) && isBlockHalf(state['half']) && isStairShape(state['shape'])

const isFenceInput = (state: Record<string, unknown>): boolean =>
  isOptionalBlockStateConnections(state['connections'])

const isWallInput = (state: Record<string, unknown>): boolean =>
  isOptionalBlockStateConnections(state['connections'])

const isDoorHalf = (value: unknown): value is DoorHalf =>
  value === 'lower' || value === 'upper'

const isDoorInput = (state: Record<string, unknown>): boolean =>
  isBlockFacing(state['facing']) && isDoorHalf(state['half']) &&
  (state['hinge'] === 'left' || state['hinge'] === 'right') && typeof state['open'] === 'boolean'

const isTrapdoorInput = (state: Record<string, unknown>): boolean =>
  isBlockFacing(state['facing']) && isBlockHalf(state['half']) && typeof state['open'] === 'boolean'

const isBedInput = (state: Record<string, unknown>): boolean =>
  isBlockFacing(state['facing']) && (state['part'] === 'head' || state['part'] === 'foot')

const isBlockShapeStateInput = (value: unknown): value is BlockShapeStateInput => {
  if (!isRecord(value)) {
    return false
  }
  switch (value['kind']) {
    case 'slab':
      return isSlabInput(value)
    case 'stairs':
      return isStairsInput(value)
    case 'fence':
      return isFenceInput(value)
    case 'wall':
      return isWallInput(value)
    case 'door':
      return isDoorInput(value)
    case 'trapdoor':
      return isTrapdoorInput(value)
    case 'bed':
      return isBedInput(value)
    case 'snow':
      return isSnowLayerCount(value['layers'])
    case 'carpet':
    case 'soulSand':
    case 'cactus':
      return true
    case 'pressurePlate':
      return typeof value['powered'] === 'boolean'
    default:
      return false
  }
}

/** Resolve a local state input to the block-local collision boxes. */
export const blockShapeForState = (input: unknown): Result.Result<BlockShape | null, RangeError> => {
  if (!isBlockShapeStateInput(input)) {
    return Result.fail(new RangeError('block shape state is invalid'))
  }
  const state = input
  if (state.kind === 'slab') {
    if (state.type === 'double') {
      return Result.succeed(FULL_BLOCK_SHAPE)
    }
    if (state.type === 'bottom') {
      return Result.succeed(SLAB_SHAPE)
    }
    return Result.succeed({ ...FULL_BLOCK_SHAPE, minY: PositionAxis(HALF_BLOCK) })
  }
  if (state.kind === 'stairs') {
    return Result.succeed(stairShapes(state))
  }
  if (state.kind === 'fence') {
    return Result.succeed(fenceShapes(state))
  }
  if (state.kind === 'wall') {
    return Result.succeed(wallShapes(state))
  }
  if (state.kind === 'door') {
    if (state.open) {
      return Result.succeed(openedDoor(state.facing, state.hinge))
    }
    return Result.succeed(closedDoor(state.facing))
  }
  if (state.kind === 'trapdoor') {
    return Result.succeed(trapdoorShape(state.facing, state.half, state.open))
  }
  if (state.kind === 'bed') {
    return Result.succeed(bedShapes(state.facing, state.part))
  }
  if (state.kind === 'carpet') {
    return Result.succeed(fullHorizontalBox(0, ONE_SIXTEENTH))
  }
  if (state.kind === 'snow') {
    if (state.layers === SNOW_LAYER_COUNTS[0]) {
      return Result.succeed(null)
    }
    return Result.succeed(fullHorizontalBox(
      0,
      ((state.layers - SNOW_LAYER_COUNTS[0]) * SNOW_LAYER_PIXELS) / PIXELS_PER_BLOCK,
    ))
  }
  if (state.kind === 'soulSand') {
    return Result.succeed(fullHorizontalBox(0, FOURTEEN_SIXTEENTHS))
  }
  if (state.kind === 'cactus') {
    return Result.succeed(CACTUS_SHAPE)
  }
  return Result.succeed(pressurePlateShape(state.powered))
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
