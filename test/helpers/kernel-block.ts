import {
  blockIdOf,
  resolvedBlockOfId,
  type BlockType,
} from '@nerima-games/mc-kernel'
import type { BlockSample } from '../../src/domain/environment-types'

export const sampleOf = (type: BlockType): BlockSample => {
  const resolved = resolvedBlockOfId(blockIdOf(type))
  if (resolved === undefined) {
    throw new Error(`Expected a registered kernel block: ${type}`)
  }
  return resolved
}
