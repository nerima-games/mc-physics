/**
 * Voxel DDA (Amanatides & Woo) block targeting: cell traversal order, face
 * and normal reporting, the shape narrow-phase, and maxDistance handling.
 * Split out of test/integrate.test.ts (FR-016); see src/domain/dda.ts and
 * src/domain/dda-shapes.ts for the implementation this exercises.
 *
 * Regression names (docs/design-notes.md):
 *   physics-dda-skips-origin-cell
 *   physics-dda-respects-max-distance
 */
import { describe, expect, it } from 'vitest'
import { FastCheck, Option } from 'effect'
import { type AABB, position } from '../src/domain/coordinates'
import {
  CACTUS_SHAPE,
  FULL_BLOCK_SHAPE,
  PRESSURE_PLATE_SHAPE,
  SLAB_SHAPE,
} from '../src/domain/shape-data'
import { voxelRaycast } from '../src/domain/dda'

describe('voxel DDA', () => {
  const solidAt = (target: readonly [number, number, number]) => (bx: number, by: number, bz: number) =>
    bx === target[0] && by === target[1] && bz === target[2]

  it('never returns the cell the ray starts in, so you cannot mine the block you are inside', () => {
      const hit = voxelRaycast(position(0.5, 0.5, 0.5), position(1, 0, 0), 8, solidAt([0, 0, 0]))
      expect(Option.isNone(hit)).toBe(true)
  })

  it('finds the first targetable cell along the ray and reports the face it entered through', () => {
      const hit = voxelRaycast(position(0.5, 0.5, 0.5), position(1, 0, 0), 8, solidAt([3, 0, 0]))
      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) {
        expect([hit.value.bx, hit.value.by, hit.value.bz]).toStrictEqual([3, 0, 0])
        // Entered through the -X face, so the normal points back at the ray.
        expect(hit.value.normal).toStrictEqual({ x: -1, y: 0, z: 0 })
        expect(hit.value.face).toBe('west')
        expect(hit.value.distance).toBeCloseTo(2.5, 10)
        expect(hit.value.point.x).toBeCloseTo(3, 10)
      }
  })

  it('uses the canonical block face for every traversal direction', () => {
      const cases = [
        { direction: position(1, 0, 0), target: [1, 0, 0] as const, face: 'west' },
        { direction: position(-1, 0, 0), target: [-1, 0, 0] as const, face: 'east' },
        { direction: position(0, 1, 0), target: [0, 1, 0] as const, face: 'down' },
        { direction: position(0, -1, 0), target: [0, -1, 0] as const, face: 'up' },
        { direction: position(0, 0, 1), target: [0, 0, 1] as const, face: 'north' },
        { direction: position(0, 0, -1), target: [0, 0, -1] as const, face: 'south' },
      ] as const

      for (const testCase of cases) {
        const hit = voxelRaycast(position(0.5, 0.5, 0.5), testCase.direction, 2, solidAt(testCase.target))
        expect(Option.isSome(hit)).toBe(true)
        if (Option.isSome(hit)) {
          expect(hit.value.face).toBe(testCase.face)
        }
      }
  })

  it('continues through the empty part of a non-cubic targetable cell', () => {
      const targetable = (bx: number, by: number, bz: number) => by === 0 && bz === 0 && (bx === 1 || bx === 2)
      const shapeAt = (bx: number) => (bx === 1 ? SLAB_SHAPE : null)
      const hit = voxelRaycast(position(0.5, 0.75, 0.5), position(1, 0, 0), 4, targetable, shapeAt)
      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) {
        expect([hit.value.bx, hit.value.by, hit.value.bz]).toStrictEqual([2, 0, 0])
        expect(hit.value.distance).toBeCloseTo(1.5, 12)
      }
  })

  it('chooses the nearest hit from compound cell geometry', () => {
      const targetable = (bx: number, by: number, bz: number) => bx === 1 && by === 0 && bz === 0
      const farther: AABB = { minX: 0.75, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }
      const nearer: AABB = { minX: 0.25, minY: 0, minZ: 0, maxX: 0.5, maxY: 1, maxZ: 1 }
      const hit = voxelRaycast(
        position(0, 0.5, 0.5),
        position(1, 0, 0),
        4,
        targetable,
        () => [farther, nearer],
      )

      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) {
        expect(hit.value.distance).toBeCloseTo(1.25, 12)
        expect(hit.value.face).toBe('west')
      }
  })

  it('treats an empty compound shape as a miss for that cell', () => {
      const targetable = (bx: number, by: number, bz: number) => by === 0 && bz === 0 && (bx === 1 || bx === 2)
      const hit = voxelRaycast(
        position(0.5, 0.5, 0.5),
        position(1, 0, 0),
        4,
        targetable,
        (bx) => (bx === 1 ? [] : FULL_BLOCK_SHAPE),
      )

      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) {
        expect([hit.value.bx, hit.value.by, hit.value.bz]).toStrictEqual([2, 0, 0])
        expect(hit.value.distance).toBeCloseTo(1.5, 12)
      }
  })

  it('hits slab, cactus and pressure-plate geometry at their actual surface', () => {
      const cases = [
        { origin: position(1.5, 1, 0.5), direction: position(0, -1, 0), shape: SLAB_SHAPE, distance: 0.5 },
        { origin: position(0, 0.5, 0.5), direction: position(1, 0, 0), shape: CACTUS_SHAPE, distance: 1 + 1 / 16 },
        { origin: position(1.5, 1, 0.5), direction: position(0, -1, 0), shape: PRESSURE_PLATE_SHAPE, distance: 15 / 16 },
      ] as const
      for (const testCase of cases) {
        const hit = voxelRaycast(testCase.origin, testCase.direction, 4, solidAt([1, 0, 0]), () => testCase.shape)
        expect(Option.isSome(hit)).toBe(true)
        if (Option.isSome(hit)) expect(hit.value.distance).toBeCloseTo(testCase.distance, 12)
      }
  })

  it('reports all six faces from the shape narrow phase', () => {
      const shape: AABB = { minX: 0.25, minY: 0.25, minZ: 0.25, maxX: 0.75, maxY: 0.75, maxZ: 0.75 }
      const cases = [
        { origin: position(0, 0.5, 0.5), direction: position(1, 0, 0), target: [1, 0, 0] as const, face: 'west' },
        { origin: position(0, 0.5, 0.5), direction: position(-1, 0, 0), target: [-1, 0, 0] as const, face: 'east' },
        { origin: position(0.5, 0, 0.5), direction: position(0, 1, 0), target: [0, 1, 0] as const, face: 'down' },
        { origin: position(0.5, 0, 0.5), direction: position(0, -1, 0), target: [0, -1, 0] as const, face: 'up' },
        { origin: position(0.5, 0.5, 0), direction: position(0, 0, 1), target: [0, 0, 1] as const, face: 'north' },
        { origin: position(0.5, 0.5, 0), direction: position(0, 0, -1), target: [0, 0, -1] as const, face: 'south' },
      ] as const
      for (const testCase of cases) {
        const hit = voxelRaycast(testCase.origin, testCase.direction, 4, solidAt(testCase.target), () => shape)
        expect(Option.isSome(hit)).toBe(true)
        if (Option.isSome(hit)) expect(hit.value.face).toBe(testCase.face)
      }
  })

  it('applies maxDistance to the shape surface and stays deterministic', () => {
      const ray = () => voxelRaycast(position(0, 0.5, 0.5), position(1, 0, 0), 1.05, solidAt([1, 0, 0]), () => CACTUS_SHAPE)
      expect(Option.isNone(ray())).toBe(true)
      const first = voxelRaycast(position(0, 0.5, 0.5), position(1, 0, 0), 1.2, solidAt([1, 0, 0]), () => CACTUS_SHAPE)
      const second = voxelRaycast(position(0, 0.5, 0.5), position(1, 0, 0), 1.2, solidAt([1, 0, 0]), () => CACTUS_SHAPE)
      expect(first).toStrictEqual(second)
  })

  it('treats an invalid out-of-cell shape as a miss', () => {
      const invalid: AABB = { minX: -1, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }
      expect(Option.isNone(voxelRaycast(position(0.5, 0.5, 0.5), position(1, 0, 0), 2, solidAt([1, 0, 0]), () => invalid))).toBe(true)
  })

  it('rejects a diagonal ray whose per-axis shape intervals do not overlap', () => {
      const shape: AABB = { minX: 0.25, minY: 0.25, minZ: 0.25, maxX: 0.75, maxY: 0.75, maxZ: 0.75 }
      const hit = voxelRaycast(position(0, 0.9, 0.5), position(1, -0.02, 0), 3, solidAt([1, 0, 0]), () => shape)
      expect(Option.isNone(hit)).toBe(true)
  })

  it('keeps an earlier entry interval when a later axis enters first', () => {
      const hit = voxelRaycast(
        position(0, 0.5, 0.5),
        position(1, 0.1, 0),
        3,
        solidAt([1, 0, 0]),
        () => ({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }),
      )
      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) expect(hit.value.face).toBe('west')
  })

  it('respects maxDistance measured in blocks, because the direction is normalised', () => {
      // The reference does not normalise, so its maxDistance is in units of the
      // caller's vector. Here 4.9 blocks short and 5.1 blocks long is the whole
      // difference, whatever length the direction vector happens to have.
      const target = solidAt([5, 0, 0])
      for (const direction of [position(1, 0, 0), position(100, 0, 0)]) {
        expect(Option.isNone(voxelRaycast(position(0.5, 0.5, 0.5), direction, 4.4, target))).toBe(true)
        expect(Option.isSome(voxelRaycast(position(0.5, 0.5, 0.5), direction, 4.6, target))).toBe(true)
      }
  })

  it('returns none for degenerate inputs instead of looping or throwing', () => {
      const anything = () => true
      expect(Option.isNone(voxelRaycast(position(0, 0, 0), position(0, 0, 0), 8, anything))).toBe(true)
      expect(Option.isNone(voxelRaycast(position(0, 0, 0), position(1, 0, 0), 0, anything))).toBe(true)
      expect(Option.isNone(voxelRaycast(position(0, 0, 0), position(1, 0, 0), -1, anything))).toBe(true)
      expect(Option.isNone(voxelRaycast(position(Number.NaN, 0, 0), position(1, 0, 0), 8, anything))).toBe(true)
      expect(Option.isNone(voxelRaycast(position(0, 0, 0), position(Number.NaN, 0, 0), 8, anything))).toBe(true)
  })

  it('returns none when the walk exhausts its step budget without a targetable cell', () => {
      const nothing = () => false
      expect(Option.isNone(voxelRaycast(position(0.5, 0.5, 0.5), position(1, 0, 0), 8, nothing))).toBe(true)
  })

  it('visits cells in strictly increasing distance order, never skipping one', () => {
      // A DDA that advances the wrong axis skips cells, and a skipped cell is a
      // block you can shoot through. Recording the visit order is the only way
      // to see that from outside.
      const visited: Array<string> = []
      voxelRaycast(position(0.5, 0.5, 0.5), position(1, 0, 0), 5, (bx, by, bz) => {
        visited.push(`${bx},${by},${bz}`)
        return false
      })
      expect(visited).toStrictEqual(['1,0,0', '2,0,0', '3,0,0', '4,0,0', '5,0,0'])
  })

  /**
   * The origin for every negative-direction case below.
   *
   * DELIBERATELY NOT THE CELL MIDPOINT. At 0.5 the two first-crossing formulas
   * `origin - cell` and `cell + 1 - origin` produce the SAME number, so a
   * negative arm that mistakenly uses the positive formula is invisible from
   * there — every cell is still visited, in order, at plausible distances. At
   * 0.75 the two disagree by half a cell and the mistake has somewhere to show.
   * This is the whole reason these tests exist, so it must not be tidied to 0.5.
   */
  const OFF_CENTRE = 0.75

  /**
   * The three negative axes, with the cell reached after `n` crossings from
   * `OFF_CENTRE`, the face the ray enters through, and the exact point on it.
   *
   * A negative step takes its first crossing distance from `origin - cell`
   * rather than from `cell + 1 - origin` (domain/dda.ts). Only these tests run
   * that arm: every other DDA test in this file walks +X, and the determinism
   * property that does reach it asserts nothing about the ANSWER — two runs of
   * a wrong traversal agree with each other perfectly.
   */
  const NEGATIVE_AXES = [
    {
      direction: position(-1, 0, 0),
      cellAfter: (crossings: number) => [-crossings, 0, 0] as const,
      normal: { x: 1, y: 0, z: 0 },
      face: 'east',
      entryPoint: { x: -2, y: OFF_CENTRE, z: OFF_CENTRE },
    },
    {
      direction: position(0, -1, 0),
      cellAfter: (crossings: number) => [0, -crossings, 0] as const,
      normal: { x: 0, y: 1, z: 0 },
      face: 'up',
      entryPoint: { x: OFF_CENTRE, y: -2, z: OFF_CENTRE },
    },
    {
      direction: position(0, 0, -1),
      cellAfter: (crossings: number) => [0, 0, -crossings] as const,
      normal: { x: 0, y: 0, z: 1 },
      face: 'south',
      entryPoint: { x: OFF_CENTRE, y: OFF_CENTRE, z: -2 },
    },
  ] as const

  const offCentreOrigin = position(OFF_CENTRE, OFF_CENTRE, OFF_CENTRE)

  it('walks the NEGATIVE direction on all three axes, one cell at a time', () => {
      // Looking down or backwards is not an exotic case — it is half of all
      // play. A negative traversal that skips or repeats a cell is a block the
      // player cannot mine while looking straight at it.
      for (const axis of NEGATIVE_AXES) {
        const visited: Array<string> = []
        voxelRaycast(offCentreOrigin, axis.direction, 5, (bx, by, bz) => {
          visited.push(`${bx},${by},${bz}`)
          return false
        })
        expect(visited).toStrictEqual([1, 2, 3, 4, 5].map((crossings) => axis.cellAfter(crossings).join(',')))
      }
  })

  it('reports the entered face, distance and point for a negative-direction hit', () => {
      // The +X case is asserted above. Mirroring it on the negative side is
      // what pins the two things the negative arm computes differently: the
      // first crossing distance, and the sign of the normal.
      for (const axis of NEGATIVE_AXES) {
        const target = axis.cellAfter(3)
        const hit = voxelRaycast(offCentreOrigin, axis.direction, 8, solidAt(target))
        expect(Option.isSome(hit)).toBe(true)
        if (Option.isSome(hit)) {
          expect([hit.value.bx, hit.value.by, hit.value.bz]).toStrictEqual([...target])
          // Points BACK at the ray, so it is the positive unit vector here.
          expect(hit.value.normal).toStrictEqual(axis.normal)
          expect(hit.value.face).toBe(axis.face)
          // 0.75 to leave the origin cell, then two whole cells. Reading 2.25
          // here means the positive-direction formula is being used: the ray
          // would be measuring its distance to the boundary it is moving AWAY
          // from, and every reach check downstream would be off by half a cell.
          expect(hit.value.distance).toBeCloseTo(OFF_CENTRE + 2, 12)
          expect(hit.value.point).toStrictEqual(axis.entryPoint)
        }
      }
  })

  it('a ray starting exactly ON a boundary and going negative enters the cell behind it', () => {
      // The degenerate input for the negative first-crossing distance: at an
      // exact boundary `origin - cell` is 0, so the ray leaves its cell
      // immediately. Computed with the positive-direction formula it would be a
      // full cell instead, and the traversal would start one cell too far along
      // — a block you can stand against and not be able to hit.
      const visited: Array<string> = []
      voxelRaycast(position(3, 0.5, 0.5), position(-1, 0, 0), 3, (bx, by, bz) => {
        visited.push(`${bx},${by},${bz}`)
        return false
      })
      expect(visited).toStrictEqual(['2,0,0', '1,0,0', '0,0,0', '-1,0,0'])
  })

  it('steps the correct axis when the direction mixes signs', () => {
      // The sign choice is PER AXIS. A negative formula applied globally, or a
      // positive one left in place on one axis, still produces a monotone walk
      // — just the wrong staircase. Asserting the staircase is what tells them
      // apart.
      //
      // The ray leaves +X first because it starts closer to its +X boundary
      // (0.25 away) than to its -Y one (0.75 away), and thereafter the two
      // alternate. Get the -Y arm wrong and it starts 0.25 away instead, so the
      // very first cell is (0,-1,0) rather than (1,0,0).
      const visited: Array<string> = []
      voxelRaycast(position(0.5, OFF_CENTRE, 0.5), position(1, -1, 0), 4, (bx, by, bz) => {
        visited.push(`${bx},${by},${bz}`)
        return false
      })
      expect(visited).toStrictEqual(['1,0,0', '1,-1,0', '2,-1,0', '2,-2,0', '3,-2,0', '3,-3,0'])
  })

  it('an all-negative diagonal arrives at the right cell through the right face', () => {
      // All three negative arms at once, plus the tie-break between them. The
      // three tMax values are equal at every step here, so the order in which
      // the axes are consulted is fully exposed: X, then Y, then Z.
      const hit = voxelRaycast(offCentreOrigin, position(-1, -1, -1), 16, solidAt([-2, -2, -2]))
      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) {
        // Z was the last axis stepped, so Z is the face that was entered. Get
        // any one of the three arms wrong and that axis falls out of step with
        // the other two, which changes WHICH face the hit is attributed to —
        // and the face normal is what decides where a placed block goes.
        expect(hit.value.normal).toStrictEqual({ x: 0, y: 0, z: 1 })
        expect(hit.value.face).toBe('south')
        // 1.75 cells along each axis, i.e. 1.75 * sqrt(3) along a unit diagonal.
        expect(hit.value.distance).toBeCloseTo((OFF_CENTRE + 1) * Math.sqrt(3), 12)
        expect(hit.value.point.x).toBeCloseTo(-1, 12)
        expect(hit.value.point.y).toBeCloseTo(-1, 12)
        expect(hit.value.point.z).toBeCloseTo(-1, 12)
      }
  })

  it('measures maxDistance in blocks in the negative direction too', () => {
      // The +X form of this is asserted above. Repeated on the negative side
      // because the distances it compares come out of the negative first-
      // crossing formula, so a bug there shifts reach without changing which
      // cells are visited — a player whose range is silently short by one.
      // The fifth cell back is entered at 0.75 + 4 blocks, so 4.7 falls short
      // and 4.8 reaches. Under the positive-direction formula it would be
      // entered at 4.25 and 4.7 would reach it, which is the assertion below
      // that fails first.
      for (const axis of NEGATIVE_AXES) {
        const target = solidAt(axis.cellAfter(5))
        expect(Option.isNone(voxelRaycast(offCentreOrigin, axis.direction, 4.7, target))).toBe(true)
        expect(Option.isSome(voxelRaycast(offCentreOrigin, axis.direction, 4.8, target))).toBe(true)
      }
  })

  it('is deterministic: the same ray against the same world always gives the same hit', () => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
          (dx, dy, dz) => {
            const target = solidAt([4, 0, 0])
            const first = voxelRaycast(position(0.5, 0.5, 0.5), position(dx, dy, dz), 16, target)
            const second = voxelRaycast(position(0.5, 0.5, 0.5), position(dx, dy, dz), 16, target)
            return JSON.stringify(first) === JSON.stringify(second)
          },
        ),
        { numRuns: 200 },
      )
  })
})
