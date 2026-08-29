/**
 * The coordinate and AABB invariants.
 *
 * plan.md §3.4 says every "things float" bug in the reference was a
 * foot-origin/centre Y mismatch. These are the tests that make the same class
 * of bug impossible here rather than merely unlikely.
 *
 * Regression names (docs/design-notes.md):
 *   physics-y-convention-is-typed
 *   physics-block-occupies-y-to-y-plus-one
 *   physics-spawn-plane-is-surface-plus-one
 *   physics-resting-contact-is-not-a-collision
 */
import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import {
  CONTACT_EPSILON,
  CentreY,
  FootY,
  HalfHeight,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  blockAABB,
  centreOfFoot,
  collidesWith,
  entityAABB,
  footOfCentre,
  intersects,
  isRestingOn,
  penetrationY,
  standingPlaneAbove,
} from '../src/domain/coordinates'
import {
  CACTUS_SHAPE,
  FULL_BLOCK_SHAPE,
  PRESSURE_PLATE_SHAPE,
  SLAB_SHAPE,
} from '../src/domain/shape-data'

const arbitraryY = FastCheck.double({ min: -1024, max: 1024, noNaN: true, noDefaultInfinity: true })
const arbitraryHalfHeight = FastCheck.double({
  min: 0.05,
  max: 8,
  noNaN: true,
  noDefaultInfinity: true,
}).map((value) => HalfHeight(value))

describe('the foot / centre Y convention', () => {
  it('round-trips foot -> centre -> foot exactly', () => {
      FastCheck.assert(
        FastCheck.property(arbitraryY, arbitraryHalfHeight, (y, halfHeight) => {
          const foot = FootY(y)
          return Math.abs(footOfCentre(centreOfFoot(foot, halfHeight), halfHeight) - foot) < 1e-9
        }),
        { numRuns: 300 },
      )
  })

  it('round-trips centre -> foot -> centre exactly', () => {
      FastCheck.assert(
        FastCheck.property(arbitraryY, arbitraryHalfHeight, (y, halfHeight) => {
          const centre = CentreY(y)
          return Math.abs(centreOfFoot(footOfCentre(centre, halfHeight), halfHeight) - centre) < 1e-9
        }),
        { numRuns: 300 },
      )
  })

  it('the centre is exactly one half-height above the feet, never zero and never a full height', () => {
      // Off-by-a-factor-of-two here is the second commonest form of the bug:
      // subtracting the full height rather than the half sinks the body into
      // the floor by exactly one body length.
      const foot = FootY(64)
      expect(centreOfFoot(foot, PLAYER_HALF_HEIGHT)).toBe(64.9)
      expect(footOfCentre(CentreY(64.9), PLAYER_HALF_HEIGHT)).toBeCloseTo(64, 10)
  })

  it('rejects a non-positive half-height, which would collapse the two conventions into one', () => {
      expect(() => HalfHeight(0)).toThrow()
      expect(() => HalfHeight(-1)).toThrow()
      expect(() => HalfHeight(Number.NaN)).toThrow()
  })
})

describe('block occupancy', () => {
  it('a block at cell y occupies exactly [y, y+1] on every axis', () => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: -256, max: 256 }),
          FastCheck.integer({ min: 0, max: 255 }),
          FastCheck.integer({ min: -256, max: 256 }),
          (bx, by, bz) => {
            const box = blockAABB(bx, by, bz)
            return (
              box.minX === bx &&
              box.maxX === bx + 1 &&
              box.minY === by &&
              box.maxY === by + 1 &&
              box.minZ === bz &&
              box.maxZ === bz + 1
            )
          },
        ),
        { numRuns: 200 },
      )
  })

  it('a slab occupies the bottom half of its cell and nothing above it', () => {
      const box = blockAABB(0, 64, 0, SLAB_SHAPE)
      expect(box.minY).toBe(64)
      expect(box.maxY).toBe(64.5)
  })

  it('a pressure plate occupies exactly the bottom sixteenth of its cell', () => {
      const box = blockAABB(-3, 64, 7, PRESSURE_PLATE_SHAPE)
      expect(box).toStrictEqual({ minX: -3, minY: 64, minZ: 7, maxX: -2, maxY: 64 + 1 / 16, maxZ: 8 })
  })

  it('a cactus is inset one sixteenth on X and Z but remains full height', () => {
      expect(blockAABB(-3, 64, 7, CACTUS_SHAPE)).toStrictEqual({
        minX: -3 + 1 / 16,
        minY: 64,
        minZ: 7 + 1 / 16,
        maxX: -3 + 15 / 16,
        maxY: 65,
        maxZ: 7 + 15 / 16,
      })
  })

  it('the full-block shape is the unit cube, so shapes compose by simple translation', () => {
      expect(FULL_BLOCK_SHAPE).toStrictEqual({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 })
  })

  it('the standing plane above a block is surfaceY + 1, not surfaceY', () => {
      // The reference spawns at `surfaceY + 1 + PLAYER_HALF_HEIGHT`
      // (spawn-selection-search.ts:206) — one to reach the block's top face,
      // then the half-height to reach the body centre. Both steps, in order.
      FastCheck.assert(
        FastCheck.property(FastCheck.integer({ min: 0, max: 254 }), (surfaceY) => {
          const foot = standingPlaneAbove(surfaceY)
          return foot === blockAABB(0, surfaceY, 0).maxY
        }),
        { numRuns: 100 },
      )
      expect(centreOfFoot(standingPlaneAbove(62), PLAYER_HALF_HEIGHT)).toBe(63.9)
  })
})

describe('resting contact', () => {
  it('an entity standing exactly on a block surface reads as resting, never as embedded', () => {
      // Touching faces must not read as a collision to be resolved, or the
      // resolver pushes the entity up every frame and it vibrates on the spot.
      //
      // Note this asserts `isRestingOn`, NOT `!intersects`. `(foot + h) - h` is
      // not exactly `foot` in IEEE-754, so an exact test fails: this very
      // property found surfaceY=1, halfHeight=0.05, where the reconstructed
      // foot lands 2 ulp below the block top. That is what CONTACT_EPSILON is
      // for, and pretending otherwise would just move the bug into the resolver.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 0, max: 254 }),
          arbitraryHalfHeight,
          (surfaceY, halfHeight) => {
            const centre = centreOfFoot(standingPlaneAbove(surfaceY), halfHeight)
            const body = entityAABB(0.5, centre, 0.5, PLAYER_HALF_WIDTH, halfHeight)
            return isRestingOn(body, blockAABB(0, surfaceY, 0))
          },
        ),
        { numRuns: 300 },
      )
  })

  it('the float error at a resting contact really is within CONTACT_EPSILON, by orders of magnitude', () => {
      // Pins the size of the error rather than merely tolerating it. If a
      // change to the conversions makes the error grow, this fails long before
      // the epsilon stops covering it.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.integer({ min: 0, max: 254 }),
          arbitraryHalfHeight,
          (surfaceY, halfHeight) => {
            const centre = centreOfFoot(standingPlaneAbove(surfaceY), halfHeight)
            const body = entityAABB(0.5, centre, 0.5, PLAYER_HALF_WIDTH, halfHeight)
            const depth = penetrationY(body, blockAABB(0, surfaceY, 0))
            return depth <= CONTACT_EPSILON / 1000
          },
        ),
        { numRuns: 300 },
      )
  })

  it('the documented counterexample is exactly as documented', () => {
      const halfHeight = HalfHeight(0.05)
      const centre = centreOfFoot(standingPlaneAbove(1), halfHeight)
      const body = entityAABB(0.5, centre, 0.5, PLAYER_HALF_WIDTH, halfHeight)
      const block = blockAABB(0, 1, 0)
      // Strictly, it overlaps. Physically, it is standing still on the floor.
      expect(intersects(body, block)).toBe(true)
      expect(isRestingOn(body, block)).toBe(true)
      expect(penetrationY(body, block)).toBeLessThan(1e-15)
      expect(penetrationY(body, block)).toBeGreaterThan(0)
  })

  it('the resting contact intersects but is not a collision — the predicates differ exactly there', () => {
      // `collidesWith` is what the resolver acts on and `intersects` is the
      // exact question. They agree everywhere except inside the contact skin,
      // which is the whole reason both exist: at the documented counterexample
      // the boxes DO overlap and nothing should move.
      const halfHeight = HalfHeight(0.05)
      const centre = centreOfFoot(standingPlaneAbove(1), halfHeight)
      const body = entityAABB(0.5, centre, 0.5, PLAYER_HALF_WIDTH, halfHeight)
      const block = blockAABB(0, 1, 0)

      expect(intersects(body, block)).toBe(true)
      expect(collidesWith(body, block)).toBe(false)

      // A body sunk a millimetre in is a collision by both readings.
      const sunk = entityAABB(0.5, CentreY(centre - 0.001), 0.5, PLAYER_HALF_WIDTH, halfHeight)
      expect(intersects(sunk, block)).toBe(true)
      expect(collidesWith(sunk, block)).toBe(true)

      // Collision implies intersection, never the other way round.
      FastCheck.assert(
        FastCheck.property(arbitraryY, arbitraryY, (a, b) => {
          const left = entityAABB(0, CentreY(a), 0, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
          const right = entityAABB(0.1, CentreY(b), 0.1, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
          return !collidesWith(left, right) || intersects(left, right)
        }),
        { numRuns: 300 },
      )
  })

  it('REGRESSION: a body nowhere near a block is not resting on it', () => {
      // `isRestingOn` used to ask `penetrationY(body, surface) <= CONTACT_EPSILON`,
      // and `penetrationY` goes NEGATIVE when the boxes are apart — so a body in
      // free fall five blocks up satisfied it, as did one pressing its head on a
      // ceiling. Every test above still passed, because they all place the body
      // exactly on the surface, where the old reading and the new one agree.
      // The gap only mattered once something asked the question somewhere else:
      // domain/resolve.ts answers "am I grounded?" by asking this of the cells
      // under the feet, and with the old predicate every airborne body was
      // grounded. Now it compares the feet to the top face, both sides.
      const block = blockAABB(0, 64, 0)
      const above = entityAABB(0.5, CentreY(70), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
      const below = entityAABB(0.5, CentreY(60), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
      const headOnTheCeiling = entityAABB(
        0.5,
        CentreY(64 - Number(PLAYER_HALF_HEIGHT)),
        0.5,
        PLAYER_HALF_WIDTH,
        PLAYER_HALF_HEIGHT,
      )

      expect(isRestingOn(above, block)).toBe(false)
      expect(isRestingOn(below, block)).toBe(false)
      // Touching, but with the head, not the feet. Not the same thing.
      expect(isRestingOn(headOnTheCeiling, block)).toBe(false)
      expect(penetrationY(headOnTheCeiling, block)).toBeLessThanOrEqual(CONTACT_EPSILON)

      // And the case it is for still reads as resting.
      const standing = entityAABB(
        0.5,
        centreOfFoot(standingPlaneAbove(64), PLAYER_HALF_HEIGHT),
        0.5,
        PLAYER_HALF_WIDTH,
        PLAYER_HALF_HEIGHT,
      )
      expect(isRestingOn(standing, block)).toBe(true)
  })

  it('an entity one epsilon BELOW the surface does intersect — the boundary is where it is claimed', () => {
      const surfaceY = 64
      const centre = CentreY(centreOfFoot(standingPlaneAbove(surfaceY), PLAYER_HALF_HEIGHT) - 0.001)
      const body = entityAABB(0.5, centre, 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
      expect(intersects(body, blockAABB(0, surfaceY, 0))).toBe(true)
  })

  it('an entity built from a FOOT Y by mistake would sink half a body — which is why the types differ', () => {
      // This test documents the bug the branding prevents. `CentreY(...)` here
      // is an explicit, visible lie; in the reference the same mistake is an
      // invisible `number` flowing into a `number` parameter.
      const surfaceY = 64
      const foot = standingPlaneAbove(surfaceY)
      const correct = entityAABB(
        0.5,
        centreOfFoot(foot, PLAYER_HALF_HEIGHT),
        0.5,
        PLAYER_HALF_WIDTH,
        PLAYER_HALF_HEIGHT,
      )
      const wrong = entityAABB(0.5, CentreY(foot), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)

      expect(intersects(correct, blockAABB(0, surfaceY, 0))).toBe(false)
      expect(intersects(wrong, blockAABB(0, surfaceY, 0))).toBe(true)
      expect(correct.minY - wrong.minY).toBeCloseTo(Number(PLAYER_HALF_HEIGHT), 10)
  })

  it('an entity AABB is symmetric about its centre on every axis', () => {
      FastCheck.assert(
        FastCheck.property(arbitraryY, arbitraryHalfHeight, (y, halfHeight) => {
          const box = entityAABB(3, CentreY(y), -7, PLAYER_HALF_WIDTH, halfHeight)
          return (
            Math.abs((box.minX + box.maxX) / 2 - 3) < 1e-9 &&
            Math.abs((box.minY + box.maxY) / 2 - y) < 1e-9 &&
            Math.abs((box.minZ + box.maxZ) / 2 + 7) < 1e-9
          )
        }),
        { numRuns: 200 },
      )
  })

  it('intersection is symmetric in its arguments', () => {
      FastCheck.assert(
        FastCheck.property(arbitraryY, arbitraryY, (a, b) => {
          const left = entityAABB(0, CentreY(a), 0, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
          const right = entityAABB(0, CentreY(b), 0, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
          return intersects(left, right) === intersects(right, left)
        }),
        { numRuns: 200 },
      )
  })
})
