import type {
  BlockAt,
  BlockEnvironment,
  EnvironmentBlockShapeAt,
} from './environment-types.js'
import type {
  BlockPropertiesAt,
  BlockShapeAt,
  ResolveOptions,
} from './resolve-types.js'
import { isEmpty, resolvedBlockOfId } from '@nerima-games/mc-kernel'
import type { HalfHeight } from './coordinates.js'

/** Reads the block id stored at a world-space block coordinate. */
export type BlockIdAt = (bx: number, by: number, bz: number) => number | null

const resolvedBlockAt = (
  blockIdAt: BlockIdAt,
  bx: number,
  by: number,
  bz: number,
) => {
  const blockId = blockIdAt(bx, by, bz)
  if (blockId === null || isEmpty(blockId)) {
    return null
  }
  return resolvedBlockOfId(blockId) ?? null
}

/** Adapts a kernel-backed block-id lookup to the environment sample contract. */
export const blockAtFromKernel = (blockIdAt: BlockIdAt): BlockAt => (bx, by, bz) =>
  resolvedBlockAt(blockIdAt, bx, by, bz)

/** Adapts a kernel-backed block-id lookup to the resolver's property contract. */
export const blockPropertiesAtFromKernel = (blockIdAt: BlockIdAt): BlockPropertiesAt => (bx, by, bz) =>
  resolvedBlockAt(blockIdAt, bx, by, bz)?.properties ?? null

/** Builds an environment that uses kernel block properties and capabilities directly. */
export const blockEnvironmentFromKernel = (
  blockIdAt: BlockIdAt,
  blockShapeAt?: EnvironmentBlockShapeAt,
): BlockEnvironment => {
  const environment: {
    readonly blockAt: BlockAt
    readonly blockShapeAt?: EnvironmentBlockShapeAt
  } = { blockAt: blockAtFromKernel(blockIdAt) }
  if (typeof blockShapeAt === 'function') {
    return { ...environment, blockShapeAt }
  }
  return environment
}

export type KernelResolveOptions = Readonly<{
  readonly blockIdAt: BlockIdAt
  readonly halfWidth: number
  readonly halfHeight: HalfHeight
  readonly blockShapeAt?: BlockShapeAt
  readonly stepHeight?: number
}>

/** Builds block-resolution options without duplicating the kernel registry data. */
export const resolveOptionsFromKernel = ({
  blockIdAt,
  halfWidth,
  halfHeight,
  blockShapeAt,
  stepHeight,
}: KernelResolveOptions): ResolveOptions => {
  const options: {
    blockPropertiesAt: BlockPropertiesAt
    blockShapeAt?: BlockShapeAt
    halfHeight: HalfHeight
    halfWidth: number
    stepHeight?: number
  } = {
    blockPropertiesAt: blockPropertiesAtFromKernel(blockIdAt),
    halfHeight,
    halfWidth,
  }
  if (typeof blockShapeAt === 'function') {
    options.blockShapeAt = blockShapeAt
  }
  if (typeof stepHeight === 'number') {
    options.stepHeight = stepHeight
  }
  return options
}
