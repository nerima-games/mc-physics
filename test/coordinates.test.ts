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
import { Option, Result } from 'effect'
import * as fc from 'fast-check'
import { BlockAxis, PositionAxis } from '@nerima-games/mc-kernel'
import { BlockLength } from '../src/domain/physical-units.js'
import {
  CONTACT_EPSILON,
  CentreY,
  FootY,
  HalfHeight,
  type AABB,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  blockAABB as blockAABBResult,
  centreOfFoot,
  collidesWith,
  entityAABB as entityAABBResult,
  footOfCentre,
  intersects,
  isRestingOn,
  penetrationY as penetrationYResult,
  standingPlaneAbove as standingPlaneAboveResult,
} from '../src/domain/coordinates'
import {
  CACTUS_SHAPE,
  FULL_BLOCK_SHAPE,
  PRESSURE_PLATE_SHAPE,
  SLAB_SHAPE,
} from '../src/domain/shape-data'

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const blockBox = (bx: number, by: number, bz: number, shape?: AABB): AABB =>
  unwrap(blockAABBResult(BlockAxis(bx), BlockAxis(by), BlockAxis(bz), shape))

const entityBox = (
  x: number,
  centreY: CentreY,
  z: number,
  halfWidth: BlockLength,
  halfHeight: HalfHeight,
): AABB => unwrap(entityAABBResult(PositionAxis(x), centreY, PositionAxis(z), halfWidth, halfHeight))

const standingPlane = (surfaceY: number) =>
  standingPlaneAboveResult(BlockAxis(surfaceY))

const penetrationDepth = (a: AABB, b: AABB): BlockLength =>
  unwrap(penetrationYResult(a, b))

const arbitraryY = fc.double({ min: -1024, max: 1024, noNaN: true, noDefaultInfinity: true })
const arbitraryHalfHeight = fc.double({
  min: 0.05,
  max: 8,
  noNaN: true,
  noDefaultInfinity: true,
}).map((value) => HalfHeight(value))

describe('the foot / centre Y convention', () => {
  it('round-trips foot -> centre -> foot exactly', () => {
      fc.assert(
        fc.property(arbitraryY, arbitraryHalfHeight, (y, halfHeight) => {
          const foot = FootY.result(y)
          if (Result.isFailure(foot)) return false
          const centre = centreOfFoot(foot.success, halfHeight)
          if (Result.isFailure(centre)) return false
          const roundTrip = footOfCentre(centre.success, halfHeight)
          return Result.isSuccess(roundTrip) && Math.abs(roundTrip.success - foot.success) < 1e-9
        }),
        { numRuns: 300 },
      )
  })

  it('round-trips centre -> foot -> centre exactly', () => {
      fc.assert(
        fc.property(arbitraryY, arbitraryHalfHeight, (y, halfHeight) => {
          const centre = CentreY.result(y)
          if (Result.isFailure(centre)) return false
          const foot = footOfCentre(centre.success, halfHeight)
          if (Result.isFailure(foot)) return false
          const roundTrip = centreOfFoot(foot.success, halfHeight)
          return Result.isSuccess(roundTrip) && Math.abs(roundTrip.success - centre.success) < 1e-9
        }),
        { numRuns: 300 },
      )
  })

  it('the centre is exactly one half-height above the feet, never zero and never a full height', () => {
      // Off-by-a-factor-of-two here is the second commonest form of the bug:
      // subtracting the full height rather than the half sinks the body into
      // the floor by exactly one body length.
      const foot = unwrap(FootY.result(64))
      const centre = centreOfFoot(foot, PLAYER_HALF_HEIGHT)
      expect(Result.isSuccess(centre)).toBe(true)
      if (Result.isSuccess(centre)) expect(centre.success).toBe(64.9)
      const loweredFoot = footOfCentre(unwrap(CentreY.result(64.9)), PLAYER_HALF_HEIGHT)
      expect(unwrap(loweredFoot)).toBeCloseTo(64, 10)
  })

  it('rejects a non-positive half-height, which would collapse the two conventions into one', () => {
      expect(() => HalfHeight(0)).toThrow()
      expect(() => HalfHeight(-1)).toThrow()
      expect(() => HalfHeight(Number.NaN)).toThrow()
  })
})

describe('coordinate brands', () => {
  it('rejects NaN and infinities without throwing', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Option.isNone(FootY.option(value))).toBe(true)
      expect(Option.isNone(CentreY.option(value))).toBe(true)
      expect(Option.isNone(HalfHeight.option(value))).toBe(true)
      expect(Result.isFailure(FootY.result(value))).toBe(true)
      expect(Result.isFailure(CentreY.result(value))).toBe(true)
    }
  })

  it('propagates invalid brands through foot, centre, and standing-plane conversions', () => {
    expect(Result.isFailure(centreOfFoot(
      // @ts-expect-error -- preserve a raw invalid value to exercise boundary validation.
      Number.NaN,
      PLAYER_HALF_HEIGHT,
    ))).toBe(true)
    expect(Result.isFailure(centreOfFoot(
      FootY(1),
      // @ts-expect-error -- preserve a raw invalid value to exercise boundary validation.
      Number.NaN,
    ))).toBe(true)
    expect(Result.isFailure(footOfCentre(
      // @ts-expect-error -- preserve a raw invalid value to exercise boundary validation.
      Number.NaN,
      PLAYER_HALF_HEIGHT,
    ))).toBe(true)
    expect(Result.isFailure(footOfCentre(
      CentreY(1),
      // @ts-expect-error -- preserve a raw invalid value to exercise boundary validation.
      Number.NaN,
    ))).toBe(true)
    expect(Result.isFailure(standingPlaneAboveResult(
      // @ts-expect-error -- preserve a raw invalid value to exercise boundary validation.
      Number.NaN,
    ))).toBe(true)
  })
})

describe('coordinate brands reject invalid inputs and computed bounds', () => {
  it('rejects NaN and infinities at coordinate boundaries', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(Result.isFailure(PositionAxis.result(value))).toBe(true)
      expect(Option.isNone(PositionAxis.option(value))).toBe(true)
      expect(Result.isFailure(BlockAxis.result(value))).toBe(true)
      expect(Option.isNone(BlockAxis.option(value))).toBe(true)
      expect(Result.isFailure(FootY.result(value))).toBe(true)
      expect(Option.isNone(FootY.option(value))).toBe(true)
      expect(Result.isFailure(CentreY.result(value))).toBe(true)
      expect(Option.isNone(CentreY.option(value))).toBe(true)
      expect(Result.isFailure(BlockLength.result(value))).toBe(true)
      expect(Option.isNone(BlockLength.option(value))).toBe(true)
    }
  })

  it('returns Result failures when AABB inputs or arithmetic outputs leave their brands', () => {
    expect(
      Result.isFailure(
        entityAABBResult(
          // @ts-expect-error -- preserve a raw invalid value to exercise boundary validation.
          Number.NaN,
          CentreY(0),
          PositionAxis(0),
          PLAYER_HALF_WIDTH,
          PLAYER_HALF_HEIGHT,
        ),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        blockAABBResult(
          // @ts-expect-error -- preserve a raw invalid value to exercise boundary validation.
          Number.POSITIVE_INFINITY,
          BlockAxis(0),
          BlockAxis(0),
        ),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        entityAABBResult(PositionAxis(1e308), CentreY(0), PositionAxis(0), BlockLength(1e308), PLAYER_HALF_HEIGHT),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        entityAABBResult(PositionAxis(0), CentreY(1e308), PositionAxis(0), PLAYER_HALF_WIDTH, HalfHeight(1e308)),
      ),
    ).toBe(true)
    const nonPositiveWidth = entityAABBResult(
      PositionAxis(0),
      CentreY(0),
      PositionAxis(0),
      BlockLength(0),
      PLAYER_HALF_HEIGHT,
    )
    expect(Result.isFailure(nonPositiveWidth)).toBe(true)
    if (Result.isFailure(nonPositiveWidth)) expect(nonPositiveWidth.failure).toBeInstanceOf(RangeError)

    const invertedShape = { ...FULL_BLOCK_SHAPE, minX: PositionAxis(2) }
    const invertedBox = blockAABBResult(BlockAxis(0), BlockAxis(0), BlockAxis(0), invertedShape)
    expect(Result.isFailure(invertedBox)).toBe(true)
    if (Result.isFailure(invertedBox)) expect(invertedBox.failure).toBeInstanceOf(RangeError)

    const invalidShape: AABB = {
      ...FULL_BLOCK_SHAPE,
      // @ts-expect-error -- preserve a raw invalid value to exercise boundary validation.
      minY: Number.POSITIVE_INFINITY,
    }
    const invalidPenetration = penetrationYResult(
      invalidShape,
      FULL_BLOCK_SHAPE,
    )
    expect(Result.isFailure(invalidPenetration)).toBe(true)
    const invertedPenetration = penetrationYResult(
      { ...FULL_BLOCK_SHAPE, minY: PositionAxis(2) },
      FULL_BLOCK_SHAPE,
    )
    expect(Result.isFailure(invertedPenetration)).toBe(true)
    if (Result.isFailure(invertedPenetration)) expect(invertedPenetration.failure).toBeInstanceOf(RangeError)
  })
})

describe('block occupancy', () => {
  it('a block at cell y occupies exactly [y, y+1] on every axis', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -256, max: 256 }),
          fc.integer({ min: 0, max: 255 }),
          fc.integer({ min: -256, max: 256 }),
          (bx, by, bz) => {
            const box = blockBox(bx, by, bz)
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
      const box = blockBox(0, 64, 0, SLAB_SHAPE)
      expect(box.minY).toBe(64)
      expect(box.maxY).toBe(64.5)
  })

  it('a pressure plate occupies exactly the bottom sixteenth of its cell', () => {
      const box = blockBox(-3, 64, 7, PRESSURE_PLATE_SHAPE)
      expect(box).toStrictEqual({ minX: -3, minY: 64, minZ: 7, maxX: -2, maxY: 64 + 1 / 16, maxZ: 8 })
  })

  it('a cactus is inset one sixteenth on X and Z but remains full height', () => {
      expect(blockBox(-3, 64, 7, CACTUS_SHAPE)).toStrictEqual({
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
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 254 }), (surfaceY) => {
          const foot = standingPlane(surfaceY)
          return Result.isSuccess(foot) && Number(foot.success) === Number(blockBox(0, surfaceY, 0).maxY)
        }),
        { numRuns: 100 },
      )
      const foot = unwrap(standingPlane(62))
      expect(unwrap(centreOfFoot(foot, PLAYER_HALF_HEIGHT))).toBe(63.9)
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
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 254 }),
          arbitraryHalfHeight,
          (surfaceY, halfHeight) => {
            const centre = unwrap(centreOfFoot(unwrap(standingPlane(surfaceY)), halfHeight))
            const body = entityBox(0.5, centre, 0.5, PLAYER_HALF_WIDTH, halfHeight)
            return isRestingOn(body, blockBox(0, surfaceY, 0))
          },
        ),
        { numRuns: 300 },
      )
  })

  it('the float error at a resting contact really is within CONTACT_EPSILON, by orders of magnitude', () => {
      // Pins the size of the error rather than merely tolerating it. If a
      // change to the conversions makes the error grow, this fails long before
      // the epsilon stops covering it.
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 254 }),
          arbitraryHalfHeight,
          (surfaceY, halfHeight) => {
            const centre = unwrap(centreOfFoot(unwrap(standingPlane(surfaceY)), halfHeight))
            const body = entityBox(0.5, centre, 0.5, PLAYER_HALF_WIDTH, halfHeight)
            const depth = penetrationDepth(body, blockBox(0, surfaceY, 0))
            return depth <= CONTACT_EPSILON / 1000
          },
        ),
        { numRuns: 300 },
      )
  })

  it('the documented counterexample is exactly as documented', () => {
      const halfHeight = HalfHeight(0.05)
      const centre = unwrap(centreOfFoot(unwrap(standingPlane(1)), halfHeight))
      const body = entityBox(0.5, centre, 0.5, PLAYER_HALF_WIDTH, halfHeight)
      const block = blockBox(0, 1, 0)
      // Strictly, it overlaps. Physically, it is standing still on the floor.
      expect(intersects(body, block)).toBe(true)
      expect(isRestingOn(body, block)).toBe(true)
      expect(penetrationDepth(body, block)).toBeLessThan(1e-15)
      expect(penetrationDepth(body, block)).toBeGreaterThan(0)
  })

  it('the resting contact intersects but is not a collision — the predicates differ exactly there', () => {
      // `collidesWith` is what the resolver acts on and `intersects` is the
      // exact question. They agree everywhere except inside the contact skin,
      // which is the whole reason both exist: at the documented counterexample
      // the boxes DO overlap and nothing should move.
      const halfHeight = HalfHeight(0.05)
      const centre = unwrap(centreOfFoot(unwrap(standingPlane(1)), halfHeight))
      const body = entityBox(0.5, centre, 0.5, PLAYER_HALF_WIDTH, halfHeight)
      const block = blockBox(0, 1, 0)

      expect(intersects(body, block)).toBe(true)
      expect(collidesWith(body, block)).toBe(false)

      // A body sunk a millimetre in is a collision by both readings.
      const sunk = entityBox(0.5, CentreY(centre - 0.001), 0.5, PLAYER_HALF_WIDTH, halfHeight)
      expect(intersects(sunk, block)).toBe(true)
      expect(collidesWith(sunk, block)).toBe(true)

      // Collision implies intersection, never the other way round.
      fc.assert(
        fc.property(arbitraryY, arbitraryY, (a, b) => {
          const left = entityBox(0, CentreY(a), 0, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
          const right = entityBox(0.1, CentreY(b), 0.1, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
          return !collidesWith(left, right) || intersects(left, right)
        }),
        { numRuns: 300 },
      )
  })

  it('REGRESSION: a body nowhere near a block is not resting on it', () => {
      // `isRestingOn` used to ask `penetrationDepth(body, surface) <= CONTACT_EPSILON`,
      // and `penetrationY` goes NEGATIVE when the boxes are apart — so a body in
      // free fall five blocks up satisfied it, as did one pressing its head on a
      // ceiling. Every test above still passed, because they all place the body
      // exactly on the surface, where the old reading and the new one agree.
      // The gap only mattered once something asked the question somewhere else:
      // domain/resolve.ts answers "am I grounded?" by asking this of the cells
      // under the feet, and with the old predicate every airborne body was
      // grounded. Now it compares the feet to the top face, both sides.
      const block = blockBox(0, 64, 0)
      const above = entityBox(0.5, CentreY(70), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
      const below = entityBox(0.5, CentreY(60), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
      const headOnTheCeiling = entityBox(
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
      expect(penetrationDepth(headOnTheCeiling, block)).toBeLessThanOrEqual(CONTACT_EPSILON)

      // And the case it is for still reads as resting.
      const standing = entityBox(
        0.5,
        unwrap(centreOfFoot(unwrap(standingPlane(64)), PLAYER_HALF_HEIGHT)),
        0.5,
        PLAYER_HALF_WIDTH,
        PLAYER_HALF_HEIGHT,
      )
      expect(isRestingOn(standing, block)).toBe(true)
  })

  it('an entity one epsilon BELOW the surface does intersect — the boundary is where it is claimed', () => {
      const surfaceY = 64
      const centre = CentreY(unwrap(centreOfFoot(unwrap(standingPlane(surfaceY)), PLAYER_HALF_HEIGHT)) - 0.001)
      const body = entityBox(0.5, centre, 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
      expect(intersects(body, blockBox(0, surfaceY, 0))).toBe(true)
  })

  it('an entity built from a FOOT Y by mistake would sink half a body — which is why the types differ', () => {
      // This test documents the bug the branding prevents. `CentreY(...)` here
      // is an explicit, visible lie; in the reference the same mistake is an
      // invisible `number` flowing into a `number` parameter.
      const surfaceY = 64
      const foot = unwrap(standingPlane(surfaceY))
      const correct = entityBox(
        0.5,
        unwrap(centreOfFoot(foot, PLAYER_HALF_HEIGHT)),
        0.5,
        PLAYER_HALF_WIDTH,
        PLAYER_HALF_HEIGHT,
      )
      const wrong = entityBox(0.5, CentreY(foot), 0.5, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)

      expect(intersects(correct, blockBox(0, surfaceY, 0))).toBe(false)
      expect(intersects(wrong, blockBox(0, surfaceY, 0))).toBe(true)
      expect(correct.minY - wrong.minY).toBeCloseTo(Number(PLAYER_HALF_HEIGHT), 10)
  })

  it('an entity AABB is symmetric about its centre on every axis', () => {
      fc.assert(
        fc.property(arbitraryY, arbitraryHalfHeight, (y, halfHeight) => {
          const box = entityBox(3, CentreY(y), -7, PLAYER_HALF_WIDTH, halfHeight)
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
      fc.assert(
        fc.property(arbitraryY, arbitraryY, (a, b) => {
          const left = entityBox(0, CentreY(a), 0, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
          const right = entityBox(0, CentreY(b), 0, PLAYER_HALF_WIDTH, PLAYER_HALF_HEIGHT)
          return intersects(left, right) === intersects(right, left)
        }),
        { numRuns: 200 },
      )
  })
})
