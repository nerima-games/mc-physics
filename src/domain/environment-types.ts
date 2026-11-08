import type {
  BlockAxis,
  BlockCapabilities,
  BlockContactDamage,
  BlockProperties,
  BlockStateCodecFailure,
  FlowingFluidKind,
} from '@nerima-games/mc-kernel'
import type {
  BlockShapeAt,
  BlockStateAt,
  BlockStateLookupFailure,
  CustomBlockShapeStateAt,
} from './block-shape-state.js'
import type { BlocksPerSecondSquared, PerSecond } from './physical-units.js'
import type { Brand, Result } from 'effect'
import type { BlockRegistryResolutionFailure } from '@nerima-games/mc-kernel/domain/block-registry'

export type FluidFlow = Readonly<{ readonly x: number; readonly y: number; readonly z: number }>

export type BlockSample = Readonly<{
  readonly properties: BlockProperties
  readonly capabilities: BlockCapabilities
}>

export type BlockLookupError = Brand.BrandError | BlockRegistryResolutionFailure

export type EnvironmentError = BlockLookupError | BlockStateCodecFailure | BlockStateLookupFailure | RangeError

export type BlockAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => Result.Result<BlockSample | null, BlockLookupError>

export type EnvironmentBlockShapeAt = BlockShapeAt

export type BlockEnvironment = Readonly<{
  readonly blockAt: BlockAt
  readonly blockShapeAt?: EnvironmentBlockShapeAt
  readonly blockIdAt?: (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => number | null
  readonly blockStateAt?: BlockStateAt
  readonly customBlockShapeStateAt?: CustomBlockShapeStateAt
}>

export type SurfaceEffects = Readonly<{
  readonly friction: number
  readonly movementDrag: number
  /** Vertical drag for materials whose vertical drag differs from horizontal (cobwebs, powder snow). Omitted leaves vy untouched. */
  readonly movementDragY?: number
}>

export type BlockHazards = Readonly<{
  readonly contactDamage: BlockContactDamage
  readonly suffocating: boolean
  readonly climbable: boolean
}>

export type FluidKindWithVolume = Exclude<FlowingFluidKind, 'none'>

export type FluidState = Readonly<{
  readonly level: number
  readonly flow: FluidFlow
}>

export type FluidStateAt = (
  bx: BlockAxis,
  by: BlockAxis,
  bz: BlockAxis,
  kind: FluidKindWithVolume,
) => FluidState | null

export type FluidEffects = Readonly<{
  readonly waterVolume: number
  readonly lavaVolume: number
  readonly flow: FluidFlow
}>

export type FluidMotionCoefficients = Readonly<{
  readonly water: Readonly<{
    readonly dragPerSecond: PerSecond
    /** Vertical drag, for a fluid whose vertical drag differs from horizontal (e.g. lava). Omitted falls back to dragPerSecond. */
    readonly dragPerSecondY?: PerSecond
    readonly buoyancyAcceleration: BlocksPerSecondSquared
    readonly flowAcceleration: BlocksPerSecondSquared
  }>
  readonly lava: Readonly<{
    readonly dragPerSecond: PerSecond
    /** Vertical drag, for a fluid whose vertical drag differs from horizontal (e.g. lava). Omitted falls back to dragPerSecond. */
    readonly dragPerSecondY?: PerSecond
    readonly buoyancyAcceleration: BlocksPerSecondSquared
    readonly flowAcceleration: BlocksPerSecondSquared
  }>
}>
