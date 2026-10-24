import {
  BlockAxis,
  BlockId,
  type BlockPosition,
  adjacentBlockPosition,
  blockPosition,
  capabilityOfBlockId,
  isEmpty,
  isKnownBlockId,
} from '@nerima-games/mc-kernel'
import type { BlockIdAt } from './kernel-world.js'
import { Result } from 'effect'

export type FallingBlockCandidate = Readonly<{
  readonly id: BlockId
  readonly position: BlockPosition
}>

type FallingBlockCandidateError =
  | Result.Result.Failure<ReturnType<typeof BlockAxis.result>>
  | Result.Result.Failure<ReturnType<typeof BlockId.result>>
  | Result.Result.Failure<ReturnType<typeof adjacentBlockPosition>>
  | Result.Result.Failure<ReturnType<typeof isKnownBlockId>>
  | Result.Result.Failure<ReturnType<typeof capabilityOfBlockId>>

const isUnsupported = (
  blockIdAt: BlockIdAt,
  position: BlockPosition,
): Result.Result<boolean, FallingBlockCandidateError> =>
  Result.flatMap(adjacentBlockPosition(position, 'down'), (below) => {
    const rawBelowId = blockIdAt(below.x, below.y, below.z)
    if (rawBelowId === null) {
      return Result.succeed(true)
    }

    return Result.flatMap(BlockId.result(rawBelowId), (belowId) => {
      if (isEmpty(belowId)) {
        return Result.succeed(true)
      }
      return Result.flatMap(isKnownBlockId(belowId), (known) => {
        if (!known) {
          return Result.succeed(true)
        }
        return Result.map(capabilityOfBlockId(belowId, 'canSupportAttachments'), (canSupport) => !canSupport)
      })
    })
  })

export const fallingBlockCandidateAt = (
  blockIdAt: BlockIdAt,
  position: BlockPosition,
): Result.Result<FallingBlockCandidate | null, FallingBlockCandidateError> => {
  const xSnapshot = position.x
  const ySnapshot = position.y
  const zSnapshot = position.z
  const coordinates = Result.all([
    BlockAxis.result(xSnapshot),
    BlockAxis.result(ySnapshot),
    BlockAxis.result(zSnapshot),
  ])

  return Result.flatMap(coordinates, ([x, y, z]) => {
    const verifiedPosition = blockPosition(x, y, z)
    const rawId = blockIdAt(x, y, z)
    if (rawId === null) {
      return Result.succeed(null)
    }

    return Result.flatMap(BlockId.result(rawId), (id) => {
      if (isEmpty(id)) {
        return Result.succeed(null)
      }
      return Result.flatMap(isKnownBlockId(id), (known) => {
        if (!known) {
          return Result.succeed(null)
        }
        return Result.flatMap(capabilityOfBlockId(id, 'fallsWhenUnsupported'), (fallsWhenUnsupported) => {
          if (!fallsWhenUnsupported) {
            return Result.succeed(null)
          }
          return Result.map(isUnsupported(blockIdAt, verifiedPosition), (unsupported) => {
            if (unsupported) {
              return { id, position }
            }
            return null
          })
        })
      })
    })
  })
}
