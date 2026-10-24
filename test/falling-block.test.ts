import { Option, Result } from 'effect'
import { BlockAxis, BlockId, type BlockPosition, blockIdOf, blockPosition } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import { fallingBlockCandidateAt } from '../src/domain/falling-block'
import type { BlockIdAt } from '../src/domain/kernel-world'

const unwrapOption = <A>(option: Option.Option<A>): A => {
  if (Option.isSome(option)) return option.value
  throw new Error('Expected Option.Some')
}

const unwrapResult = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const position = blockPosition(BlockAxis(3), BlockAxis(10), BlockAxis(-2))
const unknownId = BlockId(255)

const worldWith = (current: number | null, below: number | null): BlockIdAt => (bx, by, bz) => {
  if (bx !== position.x || bz !== position.z) return null
  if (by === position.y) return current
  if (by === position.y - 1) return below
  return null
}

describe('fallingBlockCandidateAt', () => {
  const air = unwrapOption(blockIdOf('air'))
  const sand = unwrapOption(blockIdOf('sand'))
  const stone = unwrapOption(blockIdOf('stone'))
  const torch = unwrapOption(blockIdOf('torch'))
  const candidate = { id: sand, position }

  it.each([
    ['no current block', null, stone, null],
    ['unknown current block', unknownId, stone, null],
    ['air current block', air, stone, null],
    ['non-falling current block', stone, air, null],
    ['supported falling block', sand, stone, null],
    ['falling block above air', sand, air, candidate],
    ['falling block above an unloaded cell', sand, null, candidate],
    ['falling block above an unknown cell', sand, unknownId, candidate],
    ['falling block above a non-supporting block', sand, torch, candidate],
  ])('%s', (_name, current, below, expected) => {
    expect(unwrapResult(fallingBlockCandidateAt(worldWith(current, below), position))).toEqual(expected)
  })

  it('preserves the kernel block id and world position in the candidate', () => {
    const result = unwrapResult(fallingBlockCandidateAt(worldWith(sand, null), position))

    expect(result).not.toBeNull()
    if (result === null) throw new Error('expected a falling block candidate')
    expect(result.id).toBe(sand)
    expect(result.position).toBe(position)
  })

  it('returns a failure for invalid block ids and coordinate overflow', () => {
    expect(Result.isFailure(fallingBlockCandidateAt(worldWith(Number.NaN, stone), position))).toBe(true)
    const invalidPosition = { x: Number.NaN, y: 0, z: 0 } as unknown as BlockPosition
    expect(Result.isFailure(fallingBlockCandidateAt(() => null, invalidPosition))).toBe(true)

    const atMinimumY = blockPosition(BlockAxis(0), BlockAxis(Number.MIN_SAFE_INTEGER), BlockAxis(0))
    const minimumWorld: BlockIdAt = (_bx, by, _bz) => by === atMinimumY.y ? sand : null
    expect(Result.isFailure(fallingBlockCandidateAt(minimumWorld, atMinimumY))).toBe(true)
  })
})
