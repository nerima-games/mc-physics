import {
  type BlockId,
  type BlockPosition,
  adjacentBlockPosition,
  capabilityOfBlockId,
  isEmpty,
  isKnownBlockId,
} from '@nerima-games/mc-kernel'
import type { BlockIdAt } from './kernel-world'

export type FallingBlockCandidate = Readonly<{
  readonly id: BlockId
  readonly position: BlockPosition
}>

const isUnsupported = (blockIdAt: BlockIdAt, position: BlockPosition): boolean => {
  const below = adjacentBlockPosition(position, 'down')
  const belowId = blockIdAt(below.x, below.y, below.z)

  if (belowId === null || !isKnownBlockId(belowId) || isEmpty(belowId)) {
    return true
  }

  return !capabilityOfBlockId(belowId, 'canSupportAttachments')
}

export const fallingBlockCandidateAt = (
  blockIdAt: BlockIdAt,
  position: BlockPosition,
): FallingBlockCandidate | null => {
  const id = blockIdAt(position.x, position.y, position.z)

  if (
    id === null ||
    !isKnownBlockId(id) ||
    isEmpty(id) ||
    !capabilityOfBlockId(id, 'fallsWhenUnsupported')
  ) {
    return null
  }

  if (!isUnsupported(blockIdAt, position)) {
    return null
  }
  return { id, position }
}
