/**
 * FR-011: a moving piston-arm block AABB pushing a stationary entity AABB.
 *
 * This is deliberately the one place in the package where a resolver
 * ESTABLISHES non-embedding rather than maintaining it (docs/design-notes.md
 * P-9-7): the entity did not move, the block did, and the geometry has to
 * reconcile that after the fact.
 */
import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import {
  CentreY,
  HalfHeight,
  blockAABB,
  collidesWith,
  entityAABB,
  type AABB,
} from '../src/domain/coordinates'
import { pistonExtrusion, type PistonAxis } from '../src/domain/piston'

const AXES: ReadonlyArray<PistonAxis> = ['x', 'y', 'z']

const translatedOnAxis = (box: AABB, axis: PistonAxis, delta: number): AABB => {
  if (axis === 'x') {
    return { ...box, minX: box.minX + delta, maxX: box.maxX + delta }
  }
  if (axis === 'y') {
    return { ...box, minY: box.minY + delta, maxY: box.maxY + delta }
  }
  return { ...box, minZ: box.minZ + delta, maxZ: box.maxZ + delta }
}

const translated = (box: AABB, dx: number, dy: number, dz: number): AABB => ({
  maxX: box.maxX + dx,
  maxY: box.maxY + dy,
  maxZ: box.maxZ + dz,
  minX: box.minX + dx,
  minY: box.minY + dy,
  minZ: box.minZ + dz,
})

const arbitraryCoord = FastCheck.double({ min: -200, max: 200, noNaN: true, noDefaultInfinity: true })
const arbitraryHalfExtent = FastCheck.double({ min: 0.05, max: 4, noNaN: true, noDefaultInfinity: true })
const arbitraryBox = FastCheck.tuple(
  arbitraryCoord,
  arbitraryCoord,
  arbitraryCoord,
  arbitraryHalfExtent,
  arbitraryHalfExtent,
).map(([x, y, z, halfWidth, halfHeight]) => entityAABB(x, CentreY(y), z, halfWidth, HalfHeight(halfHeight)))
const arbitraryAxis = FastCheck.constantFrom(...AXES)
const arbitraryNonZeroDistance = FastCheck.double({
  min: -4,
  max: 4,
  noNaN: true,
  noDefaultInfinity: true,
}).filter((distance) => distance !== 0)

describe('pistonExtrusion', () => {
  it('pushes a stationary entity flush ahead of a piston arm extending one block', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(1.3, CentreY(64.5), 0.5, 0.3, HalfHeight(0.3))
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
    const entity = entityAABB(50, CentreY(64.5), 0, 0.3, HalfHeight(0.3))
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 1 })

    expect(result).toEqual({ crushed: false, displacement: { x: 0, y: 0, z: 0 } })
  })

  it('returns zero displacement when the block does not move at all', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(0.5, CentreY(64.5), 0.5, 0.3, HalfHeight(0.3))
    // Entity overlaps the stationary block, but a static overlap is the
    // general resolver's precondition to maintain (P-9-7) — a piston that
    // has not moved has nothing to establish.
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 0 })

    expect(result).toEqual({ crushed: false, displacement: { x: 0, y: 0, z: 0 } })
  })

  it('reports a crush when the far side has no room for the full push', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(1.3, CentreY(64.5), 0.5, 0.3, HalfHeight(0.3))
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
    const entity = entityAABB(0.5, CentreY(64.5), 0.5, 0.5, HalfHeight(0.5))
    const before = { maxX: 2.25, maxY: 65, maxZ: 1, minX: 1.25, minY: 64, minZ: 0 }
    const wall = { maxX: -0.125, maxY: 65, maxZ: 1, minX: -1, minY: 64, minZ: 0 }
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
    const entity = entityAABB(1.3, CentreY(64.5), 0.5, 0.3, HalfHeight(0.3))
    // Same X position as the wall above, but shifted clear on Z: not in the
    // entity's path, so it must not constrain the push.
    const bystander = blockAABB(2, 64, 10)
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 1 }, [bystander])

    expect(result.crushed).toBe(false)
    expect(result.displacement).toEqual({ x: 1, y: 0, z: 0 })
  })

  it('leaves the axes perpendicular to the push exactly unchanged even when the entity is offset diagonally', () => {
    const before = blockAABB(0, 64, 0)
    const entity = entityAABB(1.3, CentreY(64.9), 0.9, 0.3, HalfHeight(0.3))
    const result = pistonExtrusion(entity, { axis: 'x', before, distance: 1 })

    expect(result.displacement.y).toBe(0)
    expect(result.displacement.z).toBe(0)
  })

  describe('properties', () => {
    it('never leaves the entity embedded in the block it was pushed away from', () => {
      FastCheck.assert(
        FastCheck.property(arbitraryBox, arbitraryBox, arbitraryAxis, arbitraryNonZeroDistance, (
          entity,
          before,
          axis,
          distance,
        ) => {
          const result = pistonExtrusion(entity, { axis, before, distance })
          const moved = translated(entity, result.displacement.x, result.displacement.y, result.displacement.z)
          const after = translatedOnAxis(before, axis, distance)
          return !collidesWith(moved, after)
        }),
        { numRuns: 300 },
      )
    })

    it('only ever displaces the push axis', () => {
      FastCheck.assert(
        FastCheck.property(arbitraryBox, arbitraryBox, arbitraryAxis, arbitraryNonZeroDistance, (
          entity,
          before,
          axis,
          distance,
        ) => {
          const { displacement } = pistonExtrusion(entity, { axis, before, distance })
          return AXES.filter((candidate) => candidate !== axis).every(
            (candidate) => displacement[candidate] === 0,
          )
        }),
        { numRuns: 300 },
      )
    })

    it('is deterministic for identical inputs', () => {
      FastCheck.assert(
        FastCheck.property(arbitraryBox, arbitraryBox, arbitraryAxis, arbitraryNonZeroDistance, (
          entity,
          before,
          axis,
          distance,
        ) => {
          const move = { axis, before, distance }
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
