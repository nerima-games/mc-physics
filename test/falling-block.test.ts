import { blockIdOf, blockPosition } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import { fallingBlockCandidateAt } from '../src/domain/falling-block'
import type { BlockIdAt } from '../src/domain/kernel-world'

const position = blockPosition(3, 10, -2)

const worldWith = (current: number | null, below: number | null): BlockIdAt => (bx, by, bz) => {
  if (bx !== position.x || bz !== position.z) return null
  if (by === position.y) return current
  if (by === position.y - 1) return below
  return null
}

describe('fallingBlockCandidateAt', () => {
  const air = blockIdOf('air')
  const sand = blockIdOf('sand')
  const stone = blockIdOf('stone')
  const torch = blockIdOf('torch')
  const candidate = { id: sand, position }

  it.each([
    ['no current block', null, stone, null],
    ['unknown current block', 999_999, stone, null],
    ['air current block', air, stone, null],
    ['non-falling current block', stone, air, null],
    ['supported falling block', sand, stone, null],
    ['falling block above air', sand, air, candidate],
    ['falling block above an unloaded cell', sand, null, candidate],
    ['falling block above an unknown cell', sand, 999_999, candidate],
    ['falling block above a non-supporting block', sand, torch, candidate],
  ])('%s', (_name, current, below, expected) => {
    expect(fallingBlockCandidateAt(worldWith(current, below), position)).toEqual(expected)
  })

  it('preserves the kernel block id and world position in the candidate', () => {
    const result = fallingBlockCandidateAt(worldWith(sand, null), position)

    expect(result).not.toBeNull()
    if (result === null) throw new Error('expected a falling block candidate')
    expect(result.id).toBe(sand)
    expect(result.position).toBe(position)
  })
})
