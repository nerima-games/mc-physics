import { Option, Result } from 'effect'
import {
  AIR_BLOCK_ID,
  BlockAxis,
  BlockId,
  PositionAxis,
  blockIdOf,
  isKnownBlockId,
  resolvedBlockOfId,
} from '@nerima-games/mc-kernel'
import { describe, expect, it, vi } from 'vitest'
import {
  FULL_BLOCK_SHAPE,
  BlockLength,
  HalfHeight,
  blockAtFromKernel,
  blockEnvironmentFromKernel,
  blockPropertiesAtFromKernel,
  resolveOptionsFromKernel,
  type AABB,
  type BlockIdAt,
} from '../src/index'

vi.mock('@nerima-games/mc-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mc-kernel')>()
  return { ...actual, resolvedBlockOfId: vi.fn(actual.resolvedBlockOfId) }
})

const unwrapOption = <A>(option: Option.Option<A>): A => {
  if (Option.isSome(option)) return option.value
  throw new Error('Expected Option.Some')
}

const unwrapResult = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const stoneId = unwrapOption(blockIdOf('stone'))
const unknownId = BlockId(255)
const cell = (value: number): BlockAxis => BlockAxis(value)

const unknownIdKnown = isKnownBlockId(unknownId)
if (Result.isFailure(unknownIdKnown) || unknownIdKnown.success) {
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
  it('resolves registered ids and treats air, unknown, and missing cells as empty', () => {
    const resolved = unwrapResult(resolvedBlockOfId(stoneId))
    expect(resolved).toBeDefined()
    expect(unwrapResult(blockAtFromKernel(idAt)(cell(0), cell(0), cell(0)))).toBe(resolved)
    expect(unwrapResult(blockAtFromKernel(idAt)(cell(1), cell(0), cell(0)))).toBeNull()
    expect(unwrapResult(blockAtFromKernel(idAt)(cell(2), cell(0), cell(0)))).toBeNull()
    expect(unwrapResult(blockAtFromKernel(idAt)(cell(3), cell(0), cell(0)))).toBeNull()

    expect(unwrapResult(blockPropertiesAtFromKernel(idAt)(cell(0), cell(0), cell(0)))).toBe(resolved?.properties)
    expect(unwrapResult(blockPropertiesAtFromKernel(idAt)(cell(1), cell(0), cell(0)))).toBeNull()
    expect(unwrapResult(blockPropertiesAtFromKernel(idAt)(cell(2), cell(0), cell(0)))).toBeNull()
  })

  it('propagates invalid block ids and kernel registry failures', () => {
    const invalidId = BlockId.result(Number.NaN)
    if (Result.isSuccess(invalidId)) throw new Error('Expected an invalid block id')
    expect(Result.isFailure(blockAtFromKernel(() => Number.NaN)(cell(0), cell(0), cell(0)))).toBe(true)

    const registryFailure = () => Result.fail(invalidId.failure)
    vi.mocked(resolvedBlockOfId).mockReturnValueOnce(registryFailure()).mockReturnValueOnce(registryFailure())

    expect(Result.isFailure(blockAtFromKernel(() => stoneId)(cell(0), cell(0), cell(0)))).toBe(true)
    expect(Result.isFailure(blockPropertiesAtFromKernel(() => stoneId)(cell(0), cell(0), cell(0)))).toBe(true)
  })

  it('builds environment queries with optional authoritative geometry', () => {
    const shape: AABB = { ...FULL_BLOCK_SHAPE, minY: PositionAxis(0.25) }
    const plain = blockEnvironmentFromKernel(idAt)
    expect(unwrapResult(plain.blockAt(cell(0), cell(0), cell(0)))?.properties)
      .toBe(unwrapResult(resolvedBlockOfId(stoneId))?.properties)
    expect(plain.blockShapeAt).toBeUndefined()

    const shaped = blockEnvironmentFromKernel(idAt, () => shape)
    expect(shaped.blockShapeAt?.(cell(0), cell(0), cell(0))).toBe(shape)
  })

  it('builds resolver options while preserving only supplied optional values', () => {
    const base = {
      blockIdAt: idAt,
      halfWidth: BlockLength(0.3),
      halfHeight: HalfHeight(0.9),
    } as const
    const plain = resolveOptionsFromKernel(base)
    expect(plain).toEqual({
      halfWidth: BlockLength(0.3),
      halfHeight: HalfHeight(0.9),
      blockPropertiesAt: expect.any(Function),
      environment: expect.objectContaining({ blockAt: expect.any(Function) }),
    })
    expect(unwrapResult(plain.blockPropertiesAt(cell(0), cell(0), cell(0))))
      .toBe(unwrapResult(resolvedBlockOfId(stoneId))?.properties)
    expect(unwrapResult(plain.environment.blockAt(cell(0), cell(0), cell(0))))
      .toBe(unwrapResult(resolvedBlockOfId(stoneId)))

    const shape: AABB = { ...FULL_BLOCK_SHAPE, maxY: PositionAxis(0.5) }
    const shaped = resolveOptionsFromKernel({ ...base, blockShapeAt: () => shape })
    expect(shaped.blockShapeAt?.(cell(0), cell(0), cell(0))).toBe(shape)
    expect(shaped.environment.blockShapeAt?.(cell(0), cell(0), cell(0))).toBe(shape)
    expect(shaped.stepHeight).toBeUndefined()

    const stepped = resolveOptionsFromKernel({ ...base, stepHeight: BlockLength(0.6) })
    expect(stepped.blockShapeAt).toBeUndefined()
    expect(stepped.stepHeight).toBe(BlockLength(0.6))

    const shapedAndStepped = resolveOptionsFromKernel({
      ...base,
      blockShapeAt: () => shape,
      stepHeight: BlockLength(0.6),
    })
    expect(shapedAndStepped.blockShapeAt?.(cell(0), cell(0), cell(0))).toBe(shape)
    expect(shapedAndStepped.stepHeight).toBe(BlockLength(0.6))
  })
})
