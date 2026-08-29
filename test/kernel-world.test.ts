import {
  AIR_BLOCK_ID,
  blockIdOf,
  isKnownBlockId,
  resolvedBlockOfId,
} from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'
import {
  FULL_BLOCK_SHAPE,
  HalfHeight,
  blockAtFromKernel,
  blockEnvironmentFromKernel,
  blockPropertiesAtFromKernel,
  resolveOptionsFromKernel,
  type AABB,
  type BlockIdAt,
} from '../src/index'

const stoneId = blockIdOf('stone')
const unknownId = 255

if (isKnownBlockId(unknownId)) {
  throw new Error('The kernel-world test requires an unregistered block id')
}

const idAt: BlockIdAt = (bx, by, bz) => {
  if (bx === 0 && by === 0 && bz === 0) {
    return stoneId
  }
  if (bx === 1 && by === 0 && bz === 0) {
    return AIR_BLOCK_ID
  }
  if (bx === 2 && by === 0 && bz === 0) {
    return unknownId
  }
  return null
}

describe('kernel-backed world queries', () => {
  it('resolves registered block ids and treats air, unknown, and missing cells as empty', () => {
    const resolved = resolvedBlockOfId(stoneId)
    expect(resolved).toBeDefined()
    expect(blockAtFromKernel(idAt)(0, 0, 0)).toBe(resolved)
    expect(blockAtFromKernel(idAt)(1, 0, 0)).toBeNull()
    expect(blockAtFromKernel(idAt)(2, 0, 0)).toBeNull()
    expect(blockAtFromKernel(idAt)(3, 0, 0)).toBeNull()

    expect(blockPropertiesAtFromKernel(idAt)(0, 0, 0)).toBe(resolved?.properties)
    expect(blockPropertiesAtFromKernel(idAt)(1, 0, 0)).toBeNull()
    expect(blockPropertiesAtFromKernel(idAt)(2, 0, 0)).toBeNull()
  })

  it('builds environment queries with optional authoritative geometry', () => {
    const shape: AABB = { ...FULL_BLOCK_SHAPE, minY: 0.25 }
    const plain = blockEnvironmentFromKernel(idAt)
    expect(plain.blockAt(0, 0, 0)?.properties).toBe(resolvedBlockOfId(stoneId)?.properties)
    expect(plain.blockShapeAt).toBeUndefined()

    const shaped = blockEnvironmentFromKernel(idAt, () => shape)
    expect(shaped.blockShapeAt?.(0, 0, 0)).toBe(shape)
  })

  it('builds resolver options while preserving only supplied optional values', () => {
    const base = {
      blockIdAt: idAt,
      halfWidth: 0.3,
      halfHeight: HalfHeight(0.9),
    } as const
    const plain = resolveOptionsFromKernel(base)
    expect(plain).toEqual({
      halfWidth: 0.3,
      halfHeight: HalfHeight(0.9),
      blockPropertiesAt: expect.any(Function),
    })
    expect(plain.blockPropertiesAt(0, 0, 0)).toBe(resolvedBlockOfId(stoneId)?.properties)

    const shape: AABB = { ...FULL_BLOCK_SHAPE, maxY: 0.5 }
    const shaped = resolveOptionsFromKernel({ ...base, blockShapeAt: () => shape })
    expect(shaped.blockShapeAt?.(0, 0, 0)).toBe(shape)
    expect(shaped.stepHeight).toBeUndefined()

    const stepped = resolveOptionsFromKernel({ ...base, stepHeight: 0.6 })
    expect(stepped.blockShapeAt).toBeUndefined()
    expect(stepped.stepHeight).toBe(0.6)

    const shapedAndStepped = resolveOptionsFromKernel({
      ...base,
      blockShapeAt: () => shape,
      stepHeight: 0.6,
    })
    expect(shapedAndStepped.blockShapeAt?.(0, 0, 0)).toBe(shape)
    expect(shapedAndStepped.stepHeight).toBe(0.6)
  })
})
