/**
 * FR-011: a moving piston-arm block AABB pushing a stationary entity AABB.
 *
 * This is deliberately the one place in the package where a resolver
 * ESTABLISHES non-embedding rather than maintaining it (docs/design-notes.md
 * P-9-7): the entity did not move, the block did, and the geometry has to
 * reconcile that after the fact.
 */
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { Result } from 'effect'
import { BlockAxis, PositionAxis } from '@nerima-games/mc-kernel'
import {
  CentreY,
  HalfHeight,
  blockAABB as rawBlockAABB,
  collidesWith,
  entityAABB as rawEntityAABB,
  type AABB,
} from '../src/domain/coordinates'
import { BlockLength } from '../src/domain/physical-units'
import { pistonExtrusion as rawPistonExtrusion, type PistonAxis } from '../src/domain/piston'

type NumericAABB = Readonly<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }>

const unwrap = <Value, Error>(result: Result.Result<Value, Error>): Value => {
  if (Result.isFailure(result)) throw new Error('Expected valid piston test geometry')
  return result.success
}

const axis = (value: number) => unwrap(PositionAxis.result(value))
const blockAxis = (value: number) => unwrap(BlockAxis.result(value))
const box = (value: NumericAABB): AABB => ({
  minX: axis(value.minX),
  minY: axis(value.minY),
  minZ: axis(value.minZ),
  maxX: axis(value.maxX),
  maxY: axis(value.maxY),
  maxZ: axis(value.maxZ),
})
const blockAABB = (x: number, y: number, z: number): AABB =>
  unwrap(rawBlockAABB(blockAxis(x), blockAxis(y), blockAxis(z)))
const entityAABB = (x: number, y: number, z: number, halfWidth: number, halfHeight: number): AABB =>
  unwrap(rawEntityAABB(
    axis(x),
    unwrap(CentreY.result(y)),
    axis(z),
    unwrap(BlockLength.result(halfWidth)),
    unwrap(HalfHeight.result(halfHeight)),
  ))
const pistonExtrusion = (entity: AABB, move: Readonly<{ axis: PistonAxis; before: AABB; distance: number }>, obstacles: ReadonlyArray<AABB> = []) =>
  unwrap(rawPistonExtrusion(entity, { ...move, distance: unwrap(BlockLength.result(move.distance)) }, obstacles))

const AXES: ReadonlyArray<PistonAxis> = ['x', 'y', 'z']

const axisValue = (value: number) => unwrap(PositionAxis.result(value))

const translatedOnAxis = (targetBox: AABB, movementAxis: PistonAxis, delta: number): AABB => {
  if (movementAxis === 'x') {
    return { ...targetBox, minX: axisValue(targetBox.minX + delta), maxX: axisValue(targetBox.maxX + delta) }
  }
  if (movementAxis === 'y') {
    return { ...targetBox, minY: axisValue(targetBox.minY + delta), maxY: axisValue(targetBox.maxY + delta) }
  }
  return { ...targetBox, minZ: axisValue(targetBox.minZ + delta), maxZ: axisValue(targetBox.maxZ + delta) }
}

const translated = (targetBox: AABB, dx: number, dy: number, dz: number): AABB => ({
  maxX: axisValue(targetBox.maxX + dx),
  maxY: axisValue(targetBox.maxY + dy),
  maxZ: axisValue(targetBox.maxZ + dz),
  minX: axisValue(targetBox.minX + dx),
  minY: axisValue(targetBox.minY + dy),
  minZ: axisValue(targetBox.minZ + dz),
})

const arbitraryCoord = fc.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true })
const arbitraryHalfExtent = fc.double({ min: 0.05, max: 4, noNaN: true, noDefaultInfinity: true })
const arbitraryBox = fc.tuple(
  arbitraryCoord,
  arbitraryCoord,
  arbitraryCoord,
  arbitraryHalfExtent,
  arbitraryHalfExtent,
).map(([x, y, z, halfWidth, halfHeight]) => entityAABB(x, y, z, halfWidth, halfHeight))
const arbitraryAxis = fc.constantFrom(...AXES)
const arbitraryNonZeroDistance = fc.double({
  min: -4,
  max: 4,
  noNaN: true,
  noDefaultInfinity: true,
}).filter((distance) => distance !== 0)

describe('pistonExtrusion', () => {
  it('pushes a stationary entity flush ahead of a piston arm extending one block', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(1.3, 64.5, 0.5, 0.3, 0.3)
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 1 })

    expect(result.crushed).toBe(false)
    expect(result.displacement).toEqual({ x: 1, y: 0, z: 0 })

    const moved = translated(entity, result.displacement.x, result.displacement.y, result.displacement.z)
    const after = translatedOnAxis(before, 'x', 1)
    expect(collidesWith(moved, after)).toBe(false)
    expect(moved.minX).toBeCloseTo(after.maxX, 10)
  })

  it('returns zero displacement when the moved block never reaches the entity', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(50, 64.5, 0, 0.3, 0.3)
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 1 })

    expect(result).toEqual({ crushed: false, displacement: { x: 0, y: 0, z: 0 } })
  })

  it('returns zero displacement when the block does not move at all', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(0.5, 64.5, 0.5, 0.3, 0.3)
    // Entity overlaps the stationary block, but a static overlap is the
    // general resolver's precondition to maintain (P-9-7) — a piston that
    // has not moved has nothing to establish.
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 0 })

    expect(result).toEqual({ crushed: false, displacement: { x: 0, y: 0, z: 0 } })
  })

  it('returns Result failures for invalid branded movement and overflowing translated bounds', () => {
    const entity = entityAABB(0.5, 64.5, 0.5, 0.3, 0.3)
    const before = box({ minX: Number.MAX_VALUE - 1, minY: 0, minZ: 0, maxX: Number.MAX_VALUE, maxY: 1, maxZ: 1 })
    const invalid = rawPistonExtrusion(entity, {
      axis: 'x',
      before,
      distance: Number.NaN as Parameters<typeof rawPistonExtrusion>[1]['distance'],
    })
    const overflow = rawPistonExtrusion(entity, {
      axis: 'x',
      before,
      distance: unwrap(BlockLength.result(Number.MAX_VALUE)),
    })

    expect(Result.isFailure(invalid)).toBe(true)
    expect(Result.isFailure(overflow)).toBe(true)
  })

  it('returns failures for invalid AABBs and an unrepresentable required push distance', () => {
    const validEntity = entityAABB(0.5, 64.5, 0.5, 0.3, 0.3)
    const invalidEntity: AABB = { ...validEntity, minX: Number.NaN as PositionAxis }
    const invalidBox = rawPistonExtrusion(
      invalidEntity,
      { axis: 'x', before: blockAABB(0, 64, 0), distance: BlockLength(1) },
    )

    const scale = Number.MAX_VALUE
    const entity = box({
      minX: -scale * 0.95,
      minY: 0,
      minZ: 0,
      maxX: scale * 0.95,
      maxY: 1,
      maxZ: 1,
    })
    const before = box({
      minX: -scale * 0.7,
      minY: 0,
      minZ: 0,
      maxX: scale * 0.7,
      maxY: 1,
      maxZ: 1,
    })
    const unrepresentablePush = rawPistonExtrusion(entity, {
      axis: 'x',
      before,
      distance: BlockLength(scale * 0.1),
    })

    expect(Result.isFailure(invalidBox)).toBe(true)
    expect(Result.isFailure(unrepresentablePush)).toBe(true)
  })

  it('reports a crush when the far side has no room for the full push', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(1.3, 64.5, 0.5, 0.3, 0.3)
    // A wall immediately ahead leaves only 0.4 of clearance, less than the
    // 1-block push the extending arm demands.
    const wall = blockAABB(2, 64, 0)
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 1 }, [wall])

    expect(result.crushed).toBe(true)
    expect(result.displacement.x).toBeCloseTo(0.4, 10)
    expect(result.displacement.y).toBe(0)
    expect(result.displacement.z).toBe(0)
  })

  it('pushes along a negative travel direction and crushes against an obstacle behind the entity', () => {
    // Retracting-side push: the block travels toward -X, so the entity's near
    // face is its minX side and the obstacle room is measured behind it.
    const entity = entityAABB(0.5, 64.5, 0.5, 0.5, 0.5)
    const before = box({ maxX: 2.25, maxY: 65, maxZ: 1, minX: 1.25, minY: 64, minZ: 0 })
    const wall = box({ maxX: -0.125, maxY: 65, maxZ: 1, minX: -1, minY: 64, minZ: 0 })
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: -0.5 }, [wall])

    // after = [0.75, 1.75]; needed push = entity.maxX(1) - after.minX(0.75) =
    // 0.25, but the wall leaves only entity.minX(0) - wall.maxX(-0.125) =
    // 0.125 of room.
    expect(result.crushed).toBe(true)
    expect(result.displacement.x).toBeCloseTo(-0.125, 10)
    expect(result.displacement.y).toBe(0)
    expect(result.displacement.z).toBe(0)
  })

  it('does not report a crush when the obstacle sits off the swept cross-section', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(1.3, 64.5, 0.5, 0.3, 0.3)
    // Same X position as the wall above, but shifted clear on Z: not in the
    // entity's path, so it must not constrain the push.
    const bystander = blockAABB(2, 64, 10)
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 1 }, [bystander])

    expect(result.crushed).toBe(false)
    expect(result.displacement).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('leaves the axes perpendicular to the push exactly unchanged even when the entity is offset diagonally', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(1.3, 64.9, 0.9, 0.3, 0.3)
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 1 })

    expect(result.displacement.y).toBe(0)
    expect(result.displacement.z).toBe(0)
  })

  describe('properties', () => {
    it('never leaves the entity embedded in the block it was pushed away from', () => {
      fc.assert(
        fc.property(arbitraryBox, arbitraryBox, arbitraryAxis, arbitraryNonZeroDistance, (
          entity,
          before,
          pushAxis,
          distance,
        ) => {
          const result = pistonExtrusion(entity, { axis: pushAxis, before, distance })
          const moved = translated(entity, result.displacement.x, result.displacement.y, result.displacement.z)
          const after = translatedOnAxis(before, pushAxis, distance)
          return !collidesWith(moved, after)
        }),
        { numRuns: 300 },
      )
    })

    it('only ever displaces the push axis', () => {
      fc.assert(
        fc.property(arbitraryBox, arbitraryBox, arbitraryAxis, arbitraryNonZeroDistance, (
          entity,
          before,
          pushAxis,
          distance,
        ) => {
          const { displacement } = pistonExtrusion(entity, { axis: pushAxis, before, distance })
          return AXES.filter((candidate) => candidate !== pushAxis).every(
            (candidate) => displacement[candidate] === 0,
          )
        }),
        { numRuns: 300 },
      )
    })

    it('is deterministic for identical inputs', () => {
      fc.assert(
        fc.property(arbitraryBox, arbitraryBox, arbitraryAxis, arbitraryNonZeroDistance, (
          entity,
          before,
          pushAxis,
          distance,
        ) => {
          const move = { axis: pushAxis, before, distance }
          const first = pistonExtrusion(entity, move)
          const second = pistonExtrusion(entity, move)
          return (
            first.crushed === second.crushed &&
            first.displacement.x === second.displacement.x &&
            first.displacement.y === second.displacement.y &&
            first.displacement.z === second.displacement.z
          )
        }),
        { numRuns: 300 },
      )
    })
  })
})
