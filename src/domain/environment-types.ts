import type { BlockCapabilities, BlockProperties, FluidKind, Position } from '@nerima-games/mc-kernel'
import type { BlockShape } from './coordinates'

export type BlockSample = Readonly<{
  readonly properties: BlockProperties
  readonly capabilities: BlockCapabilities
}>

export type BlockAt = (bx: number, by: number, bz: number) => BlockSample | null

export type EnvironmentBlockShapeAt = (bx: number, by: number, bz: number) => BlockShape | null

export type BlockEnvironment = Readonly<{
  readonly blockAt: BlockAt
  readonly blockShapeAt?: EnvironmentBlockShapeAt
}>

export type SurfaceEffects = Readonly<{
  readonly friction: number
  readonly movementDrag: number
}>

export type BlockHazards = Readonly<{
  readonly contactDamage: number
  readonly suffocating: boolean
  readonly climbable: boolean
}>

export type FluidKindWithVolume = Exclude<FluidKind, 'none'>

export type FluidState = Readonly<{
  readonly level: number
  readonly flow: Position
}>

export type FluidStateAt = (
  bx: number,
  by: number,
  bz: number,
  kind: FluidKindWithVolume,
) => FluidState | null

export type FluidEffects = Readonly<{
  readonly waterVolume: number
  readonly lavaVolume: number
  readonly flow: Position
}>

export type FluidMotionCoefficients = Readonly<{
  readonly water: Readonly<{
    readonly dragPerSecond: number
    readonly buoyancyAcceleration: number
    readonly flowAcceleration: number
  }>
  readonly lava: Readonly<{
    readonly dragPerSecond: number
    readonly buoyancyAcceleration: number
    readonly flowAcceleration: number
  }>
}>
