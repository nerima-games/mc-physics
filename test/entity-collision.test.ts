import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { Result } from 'effect'
import { EntityId, PositionAxis } from '@nerima-games/mc-kernel'
import { BlockLength, BlocksPerSecond, Mass } from '../src/domain/physical-units'
import {
  collisionOf as collisionOfResult,
  inverseMassOf as inverseMassOfResult,
  potentialPairs as potentialPairsResult,
} from '../src/domain/entity-collision'
import {
  CentreY,
  detectEntityCollisions as detectEntityCollisionsResult,
  HalfHeight,
  MAX_ITERATIONS,
  MIN_CELL_SIZE,
  normalizedOptions as normalizedOptionsResult,
  resolveEntityCollisions as resolveEntityCollisionsResult,
  type Body,
  type EntityCollider,
  type EntityCollisionOptions,
  type EntityCollisionResolution,
} from '../src/index'

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw new Error('expected a successful Result')
  return result.success
}

const collisionOptions = (cellSize: number, iterations: number, restitution: number): EntityCollisionOptions => ({
  cellSize: unwrap(BlockLength.result(cellSize)),
  iterations,
  restitution,
})

const detectEntityCollisions = (...args: Parameters<typeof detectEntityCollisionsResult>) =>
  unwrap(detectEntityCollisionsResult(...args))

const resolveEntityCollisions = (...args: Parameters<typeof resolveEntityCollisionsResult>) =>
  unwrap(resolveEntityCollisionsResult(...args))

const normalizedOptions = (options: EntityCollisionOptions) => normalizedOptionsResult(options)

const bodyOf = (
  kind: Body['kind'] = 'dynamic',
  x = 0,
  y = 1,
  z = 0,
  vx = 0,
  vy = 0,
  vz = 0,
): Body => ({
  kind,
  x: unwrap(PositionAxis.result(x)),
  y: unwrap(CentreY.result(y)),
  z: unwrap(PositionAxis.result(z)),
  vx: unwrap(BlocksPerSecond.result(vx)),
  vy: unwrap(BlocksPerSecond.result(vy)),
  vz: unwrap(BlocksPerSecond.result(vz)),
})

const entityOf = (
  id: string,
  body: Body = bodyOf(),
  overrides: Partial<EntityCollider> = {},
): EntityCollider => ({
  id: unwrap(EntityId.result(id)),
  body,
  halfWidth: unwrap(BlockLength.result(0.5)),
  halfHeight: unwrap(HalfHeight.result(0.5)),
  mass: unwrap(Mass.result(1)),
  ...overrides,
})

const resolvedAt = (result: EntityCollisionResolution, index: number): EntityCollider => {
  const entity = result.entities[index]
  if (entity === undefined) {
    throw new Error(`resolveEntityCollisions returned ${result.entities.length} entities, wanted ${index + 1}`)
  }
  return entity
}

describe('entity collision detection', () => {
  it('finds deterministic axis-aligned contacts and ignores separated pairs', () => {
    const xCollision = detectEntityCollisions([
      entityOf('first'),
      entityOf('second', bodyOf('dynamic', 0.75)),
    ])
    expect(xCollision).toHaveLength(1)
    expect(xCollision[0]).toMatchObject({
      firstId: 'first',
      secondId: 'second',
      normal: { x: 1, y: 0, z: 0 },
      penetration: 0.25,
    })

    const yCollision = detectEntityCollisions([
      entityOf('first'),
      entityOf('second', bodyOf('dynamic', 0, 0.75)),
    ])
    expect(yCollision[0]?.normal).toEqual({ x: 0, y: -1, z: 0 })

    const zCollision = detectEntityCollisions([
      entityOf('first'),
      entityOf('second', bodyOf('dynamic', 0, 1, 0.75)),
    ])
    expect(zCollision[0]?.normal).toEqual({ x: 0, y: 0, z: 1 })

    expect(detectEntityCollisions([
      entityOf('first'),
      entityOf('second', bodyOf('dynamic', 1.01)),
    ])).toEqual([])
  })

  it('orders broad-phase pairs by both entity indices', () => {
    const collisions = detectEntityCollisions([
      entityOf('first'),
      entityOf('second', bodyOf('dynamic', 0.25)),
      entityOf('third', bodyOf('dynamic', 0.5)),
    ])
    expect(collisions.map(({ firstId, secondId }) => `${firstId}:${secondId}`)).toEqual([
      'first:second',
      'first:third',
      'second:third',
    ])
  })

  it('does not generate pairs for non-collidable entities', () => {
    expect(detectEntityCollisions([
      entityOf('first'),
      entityOf('second', bodyOf(), { collidable: false }),
    ])).toEqual([])
  })

  it('skips a pair whose entity stopped being readable instead of resolving against a missing one', () => {
    // The two entities overlap by 0.25, so without the guard this reports a
    // collision. The accessor answers once, for the grid walk, and not again for
    // the narrow phase, which is what a caller-owned array with a getter or a
    // Proxy can do to any function that reads it twice.
    let reads = 0
    const unreadable: EntityCollider[] = [entityOf('first', bodyOf('dynamic', 0.75))]
    Object.defineProperty(unreadable, 1, {
      configurable: true,
      get: () => {
        reads += 1
        return reads === 1 ? entityOf('second', bodyOf('dynamic', 0.75)) : undefined
      },
    })
    unreadable.length = 2

    expect(detectEntityCollisions(unreadable)).toEqual([])
    expect(reads).toBe(2)
  })
})

  it('returns Result failure when collider bounds overflow the position range', () => {
    const entity = entityOf('large', bodyOf('dynamic', Number.MAX_VALUE), {
      halfWidth: unwrap(BlockLength.result(Number.MAX_VALUE)),
    })
    expect(Result.isFailure(detectEntityCollisionsResult([entity]))).toBe(true)
    expect(Result.isFailure(resolveEntityCollisionsResult([entity]))).toBe(true)
  })

describe('entity collision resolution', () => {
  it('copies the caller array exactly once, so a second read of it cannot reach the resolver', () => {
    // This is the contract the narrowing guard in `resolveEntityCollisions` rests
    // on: `current` is the resolver's own copy, so an index derived from it is
    // always in range. If the resolver re-read the caller's array, the accessor
    // below would be consulted again and this count would rise above one.
    let reads = 0
    const first = entityOf('first', bodyOf('dynamic', 0, 1, 0, 1))
    const second = entityOf('second', bodyOf('dynamic', 0.75, 1, 0, -1))
    const unreadable: EntityCollider[] = [first]
    Object.defineProperty(unreadable, 1, {
      configurable: true,
      get: () => {
        reads += 1
        return second
      },
    })
    unreadable.length = 2

    const options = collisionOptions(1, 3, 1)
    expect(resolveEntityCollisions(unreadable, options)).toStrictEqual(
      resolveEntityCollisions([first, second], options),
    )
    expect(reads).toBe(1)
  })

  it('separates dynamic bodies and applies restitution to approaching velocity', () => {
    const result = resolveEntityCollisions([
      entityOf('first', bodyOf('dynamic', 0, 1, 0, 1)),
      entityOf('second', bodyOf('dynamic', 0.75, 1, 0, -1)),
    ], collisionOptions(1, 3, 1))
    const first = resolvedAt(result, 0)
    const second = resolvedAt(result, 1)
    expect(first.body.x).toBeCloseTo(-0.125)
    expect(second.body.x).toBeCloseTo(0.875)
    expect(first.body.vx).toBeCloseTo(-1)
    expect(second.body.vx).toBeCloseTo(1)
    expect(result.collisions).toHaveLength(1)
    expect(detectEntityCollisions(result.entities, collisionOptions(1, 1, 0))).toEqual([])
  })

  it('moves only the dynamic side of a static contact', () => {
    const staticEntity = entityOf('static', bodyOf('static'))
    const dynamicEntity = entityOf('dynamic', bodyOf('dynamic', 0.75, 1, 0, -1))
    const result = resolveEntityCollisions([staticEntity, dynamicEntity])
    expect(result.entities[0]).toBe(staticEntity)
    expect(result.entities[1]?.body.x).toBeCloseTo(1)
    expect(result.entities[1]?.body.vx).toBeCloseTo(0)
  })

  it('builds a deterministic broad-phase pair and normalizes invalid options', () => {
    const entities = [
      entityOf('first'),
      entityOf('second', bodyOf('dynamic', 0.75)),
    ]
    expect(Result.isFailure(BlockLength.result(Number.NaN))).toBe(true)
    expect(detectEntityCollisions(entities, collisionOptions(0, Number.NaN, Number.NaN))).toHaveLength(1)
  })

  it('records separating contacts without adding an impulse and handles immovable masses', () => {
    const separating = resolveEntityCollisions([
      entityOf('first', bodyOf('dynamic', 0, 1, 0, -1)),
      entityOf('second', bodyOf('dynamic', 0.75, 1, 0, 1)),
    ], collisionOptions(1, 1, 0.5))
    expect(separating.entities[0]?.body.vx).toBe(-1)
    expect(separating.entities[1]?.body.vx).toBe(1)

    const immovable = [
      entityOf('first', bodyOf('dynamic', 0), { mass: 0 }),
      entityOf('second', bodyOf('dynamic', 0.75), { mass: 0 }),
    ]
    const result = resolveEntityCollisions(immovable, collisionOptions(0, 0, 2))
    expect(result.entities).toEqual(immovable)
    expect(result.collisions).toHaveLength(1)
  })
})

describe('resource exhaustion guards', () => {
  it('REGRESSION: normalizedOptions floors an absurdly small cellSize instead of letting the spatial hash explode', () => {
    // PoC: cellSize = 1e-6 makes a single entity register into ~6.5e17 cells.
    // Asserted against normalizedOptions directly (pure, O(1)) rather than by
    // timing a call that would hang the suite before this guard exists.
    expect(normalizedOptions(collisionOptions(1e-6, 2, 0)).cellSize).toBe(MIN_CELL_SIZE)
    // A small but finite positive cellSize is not caught by finiteOr's
    // non-finite fallback, so this is the case that actually exercises the
    // floor rather than the pre-existing "invalid input" path.
    expect(normalizedOptions(collisionOptions(0.01, 2, 0)).cellSize).toBe(MIN_CELL_SIZE)
  })

  it('REGRESSION: normalizedOptions caps an absurdly large iterations count', () => {
    expect(normalizedOptions(collisionOptions(2, 1e9, 0)).iterations).toBe(MAX_ITERATIONS)
    expect(normalizedOptions(collisionOptions(2, 1_000_000, 0)).iterations).toBe(
      MAX_ITERATIONS,
    )
  })

  it('an absurdly small cellSize still completes and matches the MIN_CELL_SIZE result exactly', () => {
    // Safe to call detectEntityCollisions with the extreme value directly now
    // that normalizedOptions floors it before potentialPairs ever divides by
    // it — pre-fix this call would have hung the suite instead of failing an
    // assertion.
    const entities = [entityOf('first'), entityOf('second', bodyOf('dynamic', 0.75))]
    expect(detectEntityCollisions(entities, collisionOptions(1e-6, 2, 0))).toEqual(
      detectEntityCollisions(entities, collisionOptions(MIN_CELL_SIZE, 2, 0)),
    )
  })

  it('an absurdly large iterations count still completes and matches the MAX_ITERATIONS result exactly', () => {
    const entities = [
      entityOf('first', bodyOf('dynamic', 0, 1, 0, 1)),
      entityOf('second', bodyOf('dynamic', 0.75, 1, 0, -1)),
    ]
    expect(resolveEntityCollisions(entities, collisionOptions(1, 1e9, 1))).toEqual(
      resolveEntityCollisions(entities, collisionOptions(1, MAX_ITERATIONS, 1)),
    )
  })
})

describe('entity collision resolution properties', () => {
  it('conserves momentum for an equal-mass dynamic pair: the two velocity changes sum to zero', () => {
    // resolvePair (src/domain/entity-collision-resolve.ts) applies the collision
    // impulse as dv = impulse * (-inverseMassOf(first)) to the first body and
    // dv = impulse * inverseMassOf(second) to the second. inverseMassOf is
    // 1/mass for a dynamic body, so with equal, finite, positive masses the two
    // inverse masses are equal and the velocity changes are exact opposites
    // regardless of restitution, penetration, or iteration count. A
    // kinematic/static body has inverseMassOf 0 (infinite mass), which breaks
    // the symmetry, so this property is restricted to dynamic/dynamic pairs.
    const arbitraryPosition = fc.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true })
    const arbitraryVelocity = fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true })
    const arbitraryHalfExtent = fc.double({ min: 0.2, max: 1.5, noNaN: true, noDefaultInfinity: true })
    const arbitraryMass = fc.double({ min: 0.1, max: 50, noNaN: true, noDefaultInfinity: true })
    const arbitraryRestitution = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
    const arbitraryIterations = fc.integer({ min: 1, max: 5 })

    let collidedAtLeastOnce = false

    fc.assert(
      fc.property(
        fc.tuple(arbitraryPosition, arbitraryPosition, arbitraryPosition, arbitraryVelocity, arbitraryVelocity, arbitraryVelocity),
        fc.tuple(arbitraryPosition, arbitraryPosition, arbitraryPosition, arbitraryVelocity, arbitraryVelocity, arbitraryVelocity),
        arbitraryHalfExtent,
        arbitraryMass,
        arbitraryRestitution,
        arbitraryIterations,
        ([x1, y1, z1, vx1, vy1, vz1], [x2, y2, z2, vx2, vy2, vz2], halfExtent, mass, restitution, iterations) => {
          const body1 = bodyOf('dynamic', x1, y1, z1, vx1, vy1, vz1)
          const body2 = bodyOf('dynamic', x2, y2, z2, vx2, vy2, vz2)
          const halfWidth = unwrap(BlockLength.result(halfExtent))
          const validMass = unwrap(Mass.result(mass))
          const halfHeight = unwrap(HalfHeight.result(halfExtent))
          const first = entityOf('first', body1, { halfHeight, halfWidth, mass: validMass })
          const second = entityOf('second', body2, { halfHeight, halfWidth, mass: validMass })

          const result = resolveEntityCollisions([first, second], collisionOptions(2, iterations, restitution))
          if (result.collisions.length > 0) {
            collidedAtLeastOnce = true
          }

          const resolvedFirst = resolvedAt(result, 0).body
          const resolvedSecond = resolvedAt(result, 1).body
          const dvx = (resolvedFirst.vx - vx1) + (resolvedSecond.vx - vx2)
          const dvy = (resolvedFirst.vy - vy1) + (resolvedSecond.vy - vy2)
          const dvz = (resolvedFirst.vz - vz1) + (resolvedSecond.vz - vz2)
          return Math.abs(dvx) < 1e-6 && Math.abs(dvy) < 1e-6 && Math.abs(dvz) < 1e-6
        },
      ),
      { numRuns: 300 },
    )

    expect(collidedAtLeastOnce).toBe(true)
  })
})


describe('entity collision Result boundaries', () => {
  it('propagates invalid ids, inverse masses, velocities, and spatial-hash bounds', () => {
    const first = entityOf('first')
    const invalidId: EntityCollider = {
      ...entityOf('second', bodyOf('dynamic', 0.75)),
      // @ts-expect-error Exercise runtime rejection of an invalid entity id.
      id: ' ',
    }
    expect(Result.isFailure(detectEntityCollisionsResult([first, invalidId]))).toBe(true)
    expect(Result.isFailure(resolveEntityCollisionsResult([invalidId]))).toBe(true)

    const invalidMass: EntityCollider = {
      ...entityOf('bad-mass'),
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      mass: Number.NaN,
    }
    expect(Result.isFailure(inverseMassOfResult(invalidMass))).toBe(true)
    expect(Result.isFailure(resolveEntityCollisionsResult([invalidMass]))).toBe(true)

    const invalidVelocity: EntityCollider = {
      ...entityOf('bad-velocity'),
      body: {
        ...bodyOf(),
        // @ts-expect-error Exercise runtime rejection of a malformed branded value.
        vx: Number.NaN,
      },
    }
    expect(Result.isFailure(resolveEntityCollisionsResult([invalidVelocity]))).toBe(true)

    const farEntity = {
      ...entityOf('far'),
      body: { ...bodyOf(), x: PositionAxis(Number.MAX_SAFE_INTEGER + 20) },
    }
    expect(Result.isFailure(detectEntityCollisionsResult([farEntity], collisionOptions(1, 1, 0)))).toBe(true)
    expect(Result.isFailure(potentialPairsResult(
      [],
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      Number.NaN,
    ))).toBe(true)
  })

  it('propagates collider-box, penetration, and collision-pair failures', () => {
    let xReads = 0
    const ordinaryBody = bodyOf('dynamic', 0.75)
    const unstableBody: Body = {
      ...ordinaryBody,
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      get x() {
        xReads += 1
        if (xReads === 1) return ordinaryBody.x
        return Number.NaN
      },
    }
    const changingCollider = entityOf('second', unstableBody)
    expect(Result.isFailure(detectEntityCollisionsResult([
      entityOf('first'),
      changingCollider,
    ]))).toBe(true)

    const hugeHalfHeight = unwrap(HalfHeight.result(Number.MAX_VALUE))
    const hugeFirst = entityOf('huge-first', bodyOf(), {
      halfWidth: BlockLength(Number.MAX_VALUE),
      halfHeight: hugeHalfHeight,
    })
    const hugeSecond = entityOf('huge-second', bodyOf('dynamic', 0.25), {
      halfWidth: BlockLength(Number.MAX_VALUE),
      halfHeight: hugeHalfHeight,
    })
    expect(Result.isFailure(collisionOfResult(hugeFirst, hugeSecond))).toBe(true)
    expect(Result.isFailure(detectEntityCollisionsResult(
      [hugeFirst, hugeSecond],
      collisionOptions(Number.MAX_VALUE, 1, 0),
    ))).toBe(true)
  })
})

describe('entity collision resolver Result boundaries', () => {
  it('rejects overflowing inverse-mass sums and positional corrections', () => {
    const tinyMass = unwrap(Mass.result(1e-308))
    const sumOverflow = resolveEntityCollisionsResult([
      entityOf('first', bodyOf('dynamic', 0), { mass: tinyMass }),
      entityOf('second', bodyOf('dynamic', 0.75), { mass: tinyMass }),
    ])
    expect(Result.isFailure(sumOverflow)).toBe(true)

    const smallerInverseMass = unwrap(Mass.result(2e-308))
    const wideBody = {
      halfWidth: BlockLength(3),
      halfHeight: unwrap(HalfHeight.result(3)),
    }
    const firstCorrectionOverflow = resolveEntityCollisionsResult([
      entityOf('first', bodyOf('dynamic', 0), { ...wideBody, mass: smallerInverseMass }),
      entityOf('second', bodyOf('dynamic', 0.75), { ...wideBody, mass: smallerInverseMass }),
    ], collisionOptions(Number.MAX_VALUE, 1, 0))
    expect(Result.isFailure(firstCorrectionOverflow)).toBe(true)

    const secondCorrectionOverflow = resolveEntityCollisionsResult([
      entityOf('first', bodyOf('dynamic', 0), { ...wideBody, mass: Mass(1) }),
      entityOf('second', bodyOf('dynamic', 0.75), { ...wideBody, mass: smallerInverseMass }),
    ], collisionOptions(Number.MAX_VALUE, 1, 0))
    expect(Result.isFailure(secondCorrectionOverflow)).toBe(true)
  })

  it('rejects overflowing relative velocities and impulses on either dynamic side', () => {
    const relativeVelocityOverflow = resolveEntityCollisionsResult([
      entityOf('first', bodyOf('dynamic', 0, 1, 0, Number.MAX_VALUE)),
      entityOf('second', bodyOf('dynamic', 0.75, 1, 0, -Number.MAX_VALUE)),
    ], collisionOptions(2, 1, 0))
    expect(Result.isFailure(relativeVelocityOverflow)).toBe(true)

    const firstVelocityOverflow = resolveEntityCollisionsResult([
      entityOf('first', bodyOf('dynamic', 0, 1, 0, Number.MAX_VALUE), { mass: Mass(Number.MAX_VALUE) }),
      entityOf('second', bodyOf('static', 0.75), { mass: 0 }),
    ], collisionOptions(2, 1, 0))
    expect(Result.isFailure(firstVelocityOverflow)).toBe(true)

    const secondVelocityOverflow = resolveEntityCollisionsResult([
      entityOf('first', bodyOf('static', 0), { mass: 0 }),
      entityOf('second', bodyOf('dynamic', 0.75, 1, 0, -Number.MAX_VALUE)),
    ], collisionOptions(2, 1, 1))
    expect(Result.isFailure(secondVelocityOverflow)).toBe(true)
  })

  it('skips sparse entity slots and propagates failures from changed entity fields', () => {
    // @ts-expect-error Exercise the resolver's handling of a malformed sparse entity list.
    const sparseResult = resolveEntityCollisionsResult([entityOf('first'), undefined])
    expect(Result.isSuccess(sparseResult)).toBe(true)
    if (Result.isSuccess(sparseResult)) {
      expect(sparseResult.success.entities).toHaveLength(2)
      expect(sparseResult.success.entities[1]).toBeUndefined()
    }

    let massReads = 0
    const changingMass: EntityCollider = {
      ...entityOf('first'),
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      get mass() {
        massReads += 1
        if (massReads === 1) return Mass(1)
        return Number.NaN
      },
    }
    expect(Result.isFailure(resolveEntityCollisionsResult([
      changingMass,
      entityOf('second', bodyOf('dynamic', 0.75)),
    ], collisionOptions(2, 1, 0)))).toBe(true)

    let xReads = 0
    const ordinaryBody = bodyOf('dynamic', 0.75)
    const changingBody: Body = {
      ...ordinaryBody,
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      get x() {
        xReads += 1
        if (xReads === 1) return ordinaryBody.x
        return Number.NaN
      },
    }
    expect(Result.isFailure(resolveEntityCollisionsResult([
      entityOf('first'),
      entityOf('second', changingBody),
    ], collisionOptions(2, 1, 0)))).toBe(true)
  })

})

describe('remaining entity collision Result boundaries', () => {
  it('uses the default spatial-hash cell size for zero', () => {
    const pairs = potentialPairsResult([
      entityOf('first'),
      entityOf('second', bodyOf('dynamic', 0.75)),
    ], BlockLength(0))

    expect(unwrap(pairs)).toEqual([[0, 1]])
  })

  it('propagates a mass validation failure discovered while resolving a pair', () => {
    let massReads = 0
    const changingMass: EntityCollider = {
      ...entityOf('second', bodyOf('dynamic', 0.75)),
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      get mass() {
        massReads += 1
        if (massReads <= 2) return Mass(1)
        return Number.NaN
      },
    }

    const result = resolveEntityCollisionsResult([
      entityOf('first'),
      changingMass,
    ], collisionOptions(2, 1, 0))

    expect(Result.isFailure(result)).toBe(true)
    expect(massReads).toBe(4)
  })

  it('rejects positional corrections that overflow either translated entity', () => {
    const positiveOverflow = resolveEntityCollisionsResult([
      entityOf('first', bodyOf('dynamic', Number.MAX_VALUE * 0.65), {
        halfWidth: BlockLength(Number.MAX_VALUE * 0.25),
        halfHeight: HalfHeight(Number.MAX_VALUE * 0.2),
        mass: Mass(100),
      }),
      entityOf('second', bodyOf('dynamic', Number.MAX_VALUE * 0.85), {
        halfWidth: BlockLength(Number.MAX_VALUE * 0.15),
        halfHeight: HalfHeight(Number.MAX_VALUE * 0.2),
        mass: Mass(1),
      }),
    ], collisionOptions(Number.MAX_VALUE, 1, 0))

    const negativeOverflow = resolveEntityCollisionsResult([
      entityOf('first', bodyOf('dynamic', -Number.MAX_VALUE * 0.85), {
        halfWidth: BlockLength(Number.MAX_VALUE * 0.15),
        halfHeight: HalfHeight(Number.MAX_VALUE * 0.2),
        mass: Mass(1),
      }),
      entityOf('second', bodyOf('dynamic', -Number.MAX_VALUE * 0.65), {
        halfWidth: BlockLength(Number.MAX_VALUE * 0.25),
        halfHeight: HalfHeight(Number.MAX_VALUE * 0.2),
        mass: Mass(100),
      }),
    ], collisionOptions(Number.MAX_VALUE, 1, 0))

    expect(Result.isFailure(positiveOverflow)).toBe(true)
    expect(Result.isFailure(negativeOverflow)).toBe(true)
  })
})
