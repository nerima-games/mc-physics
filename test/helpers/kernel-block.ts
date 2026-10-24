import { Option, Result } from 'effect'
import {
  blockIdOf,
  resolvedBlockOfId,
  type BlockType,
} from '@nerima-games/mc-kernel'
import type { BlockSample } from '../../src/domain/environment-types'

export const sampleOf = (type: BlockType): BlockSample => {
  const id = blockIdOf(type)
  if (Option.isNone(id)) {
    throw new Error(`Expected a registered kernel block: ${type}`)
  }
  const resolved = resolvedBlockOfId(id.value)
  if (Result.isFailure(resolved) || resolved.success === undefined) {
    throw new Error(`Expected a resolved kernel block: ${type}`)
  }
  return resolved.success
}
