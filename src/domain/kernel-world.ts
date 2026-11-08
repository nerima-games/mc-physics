import type {
  BlockAt,
  BlockEnvironment,
  EnvironmentBlockShapeAt,
} from './environment-types.js'
import { type BlockAxis, BlockId, isEmpty, resolvedBlockOfId } from '@nerima-games/mc-kernel'
import type {
  BlockPropertiesAt,
  BlockShapeAt,
  ResolveOptions,
} from './resolve-types.js'
import type { BlockLength } from './physical-units.js'
import type { BlockShapeStateAt } from './block-shape-state.js'
import type { HalfHeight } from './coordinates.js'
import { Result } from 'effect'

/** Reads the block id stored at a world-space block coordinate. */
export type BlockIdAt = (bx: BlockAxis, by: BlockAxis, bz: BlockAxis) => number | null

const resolvedBlockAt = (
  blockIdAt: BlockIdAt,
  bx: BlockAxis,
  by: BlockAxis,
  bz: BlockAxis,
) => {
  const rawBlockId = blockIdAt(bx, by, bz)
  if (rawBlockId === null) {
    return Result.succeed(null)
  }
  return Result.flatMap(BlockId.result(rawBlockId), (blockId) => {
    if (isEmpty(blockId)) {
      return Result.succeed(null)
    }
    return Result.map(resolvedBlockOfId(blockId), (resolved) => resolved ?? null)
  })
}

/** Adapts a kernel-backed block-id lookup to the environment sample contract. */
export const blockAtFromKernel = (blockIdAt: BlockIdAt): BlockAt => (bx, by, bz) =>
  resolvedBlockAt(blockIdAt, bx, by, bz)

/** Adapts a kernel-backed block-id lookup to the resolver's property contract. */
export const blockPropertiesAtFromKernel = (blockIdAt: BlockIdAt): BlockPropertiesAt => (bx, by, bz) =>
  Result.map(resolvedBlockAt(blockIdAt, bx, by, bz), (resolved) => resolved?.properties ?? null)

/** Builds an environment that uses kernel block properties and capabilities directly. */
export const blockEnvironmentFromKernel = (
  blockIdAt: BlockIdAt,
  blockShapeAt?: EnvironmentBlockShapeAt,
  blockShapeStateAt?: BlockShapeStateAt,
): BlockEnvironment => {
  const environment: {
    readonly blockAt: BlockAt
    readonly blockShapeAt?: EnvironmentBlockShapeAt
    readonly blockShapeStateAt?: BlockShapeStateAt
  } = { blockAt: blockAtFromKernel(blockIdAt) }
  if (typeof blockShapeAt === 'function') {
    if (typeof blockShapeStateAt === 'function') {
      return { ...environment, blockShapeAt, blockShapeStateAt }
    }
    return { ...environment, blockShapeAt }
  }
  if (typeof blockShapeStateAt === 'function') {
    return { ...environment, blockShapeStateAt }
  }
  return environment
}

export type KernelResolveOptions = Readonly<{
  readonly blockIdAt: BlockIdAt
  readonly halfWidth: BlockLength
  readonly halfHeight: HalfHeight
  readonly blockShapeAt?: BlockShapeAt
  readonly blockShapeStateAt?: BlockShapeStateAt
  readonly stepHeight?: BlockLength
}>

/** Builds block-resolution options without duplicating the kernel registry data. */
export const resolveOptionsFromKernel = ({
  blockIdAt,
  halfWidth,
  halfHeight,
  blockShapeAt,
  blockShapeStateAt,
  stepHeight,
}: KernelResolveOptions): ResolveOptions => {
  const options: {
    blockPropertiesAt: BlockPropertiesAt
    blockShapeAt?: BlockShapeAt
    blockShapeStateAt?: BlockShapeStateAt
    environment: BlockEnvironment
    halfHeight: HalfHeight
    halfWidth: BlockLength
    stepHeight?: BlockLength
  } = {
    blockPropertiesAt: blockPropertiesAtFromKernel(blockIdAt),
    environment: blockEnvironmentFromKernel(blockIdAt, blockShapeAt, blockShapeStateAt),
    halfHeight,
    halfWidth,
  }
  if (typeof blockShapeAt === 'function') {
    options.blockShapeAt = blockShapeAt
  }
  if (typeof blockShapeStateAt === 'function') {
    options.blockShapeStateAt = blockShapeStateAt
  }
  if (typeof stepHeight === 'number') {
    options.stepHeight = stepHeight
  }
  return options
}
