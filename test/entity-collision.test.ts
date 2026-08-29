import { describe, expect, it } from 'vitest'
import { FastCheck } from 'effect'
import {
  CentreY,
  detectEntityCollisions,
  HalfHeight,
  MAX_ITERATIONS,
  MIN_CELL_SIZE,
  normalizedOptions,
  resolveEntityCollisions,
  type Body,
  type EntityCollider,
} from '../src/index'

const bodyOf = (
  kind: Body['kind'] = 'dynamic',
  x = 0,
  y = 1,
  z = 0,
  vx = 0,
): Body => ({ kind, x, y: CentreY(y), z, vx, vy: 0, vz: 0 })

const entityOf = (
  id: string,
  body: Body = bodyOf(),
  overrides: Partial<EntityCollider> = {},
): EntityCollider => ({
  id,
  body,
  halfWidth: 0.5,
  halfHeight: HalfHeight(0.5),
  mass: 1,
  ...overrides,
})

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
})

describe('entity collision resolution', () => {
  it('separates dynamic bodies and applies restitution to approaching velocity', () => {
    const result = resolveEntityCollisions([
      entityOf('first', bodyOf('dynamic', 0, 1, 0, 1)),
      entityOf('second', bodyOf('dynamic', 0.75, 1, 0, -1)),
    ], { cellSize: 1, iterations: 3, restitution: 1 })
    const first = result.entities[0]!
    const second = result.entities[1]!
    expect(first.body.x).toBeCloseTo(-0.125)
    expect(second.body.x).toBeCloseTo(0.875)
    expect(first.body.vx).toBeCloseTo(-1)
    expect(second.body.vx).toBeCloseTo(1)
    expect(result.collisions).toHaveLength(1)
    expect(detectEntityCollisions(result.entities, { cellSize: 1, iterations: 1, restitution: 0 })).toEqual([])
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
    expect(detectEntityCollisions(entities, {
      cellSize: Number.NaN,
      iterations: Number.NaN,
      restitution: Number.NaN,
    })).toHaveLength(1)
  })

  it('records separating contacts without adding an impulse and handles immovable masses', () => {
    const separating = resolveEntityCollisions([
      entityOf('first', bodyOf('dynamic', 0, 1, 0, -1)),
      entityOf('second', bodyOf('dynamic', 0.75, 1, 0, 1)),
    ], { cellSize: 1, iterations: 1, restitution: 0.5 })
    expect(separating.entities[0]?.body.vx).toBe(-1)
    expect(separating.entities[1]?.body.vx).toBe(1)

    const immovable = [
      entityOf('first', bodyOf('dynamic', 0), { mass: 0 }),
      entityOf('second', bodyOf('dynamic', 0.75), { mass: 0 }),
    ]
    const result = resolveEntityCollisions(immovable, { cellSize: 0, iterations: 0, restitution: 2 })
    expect(result.entities).toEqual(immovable)
    expect(result.collisions).toHaveLength(1)
  })
})

describe('resource exhaustion guards', () => {
  it('REGRESSION: normalizedOptions floors an absurdly small cellSize instead of letting the spatial hash explode', () => {
    // PoC: cellSize = 1e-6 makes a single entity register into ~6.5e17 cells.
    // Asserted against normalizedOptions directly (pure, O(1)) rather than by
    // timing a call that would hang the suite before this guard exists.
    expect(normalizedOptions({ cellSize: 1e-6, iterations: 2, restitution: 0 }).cellSize).toBe(MIN_CELL_SIZE)
    // A small but finite positive cellSize is not caught by finiteOr's
    // non-finite fallback, so this is the case that actually exercises the
    // floor rather than the pre-existing "invalid input" path.
    expect(normalizedOptions({ cellSize: 0.01, iterations: 2, restitution: 0 }).cellSize).toBe(MIN_CELL_SIZE)
  })

  it('REGRESSION: normalizedOptions caps an absurdly large iterations count', () => {
    expect(normalizedOptions({ cellSize: 2, iterations: 1e9, restitution: 0 }).iterations).toBe(MAX_ITERATIONS)
    expect(normalizedOptions({ cellSize: 2, iterations: 1_000_000, restitution: 0 }).iterations).toBe(
      MAX_ITERATIONS,
    )
  })

  it('an absurdly small cellSize still completes and matches the MIN_CELL_SIZE result exactly', () => {
    // Safe to call detectEntityCollisions with the extreme value directly now
    // that normalizedOptions floors it before potentialPairs ever divides by
    // it — pre-fix this call would have hung the suite instead of failing an
    // assertion.
    const entities = [entityOf('first'), entityOf('second', bodyOf('dynamic', 0.75))]
    expect(detectEntityCollisions(entities, { cellSize: 1e-6, iterations: 2, restitution: 0 })).toEqual(
      detectEntityCollisions(entities, { cellSize: MIN_CELL_SIZE, iterations: 2, restitution: 0 }),
    )
  })

  it('an absurdly large iterations count still completes and matches the MAX_ITERATIONS result exactly', () => {
    const entities = [
      entityOf('first', bodyOf('dynamic', 0, 1, 0, 1)),
      entityOf('second', bodyOf('dynamic', 0.75, 1, 0, -1)),
    ]
    expect(resolveEntityCollisions(entities, { cellSize: 1, iterations: 1e9, restitution: 1 })).toEqual(
      resolveEntityCollisions(entities, { cellSize: 1, iterations: MAX_ITERATIONS, restitution: 1 }),
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
    const arbitraryPosition = FastCheck.double({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true })
    const arbitraryVelocity = FastCheck.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true })
    const arbitraryHalfExtent = FastCheck.double({ min: 0.2, max: 1.5, noNaN: true, noDefaultInfinity: true })
    const arbitraryMass = FastCheck.double({ min: 0.1, max: 50, noNaN: true, noDefaultInfinity: true })
    const arbitraryRestitution = FastCheck.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
    const arbitraryIterations = FastCheck.integer({ min: 1, max: 5 })

    let collidedAtLeastOnce = false

    FastCheck.assert(
      FastCheck.property(
        FastCheck.tuple(arbitraryPosition, arbitraryPosition, arbitraryPosition, arbitraryVelocity, arbitraryVelocity, arbitraryVelocity),
        FastCheck.tuple(arbitraryPosition, arbitraryPosition, arbitraryPosition, arbitraryVelocity, arbitraryVelocity, arbitraryVelocity),
        arbitraryHalfExtent,
        arbitraryMass,
        arbitraryRestitution,
        arbitraryIterations,
        ([x1, y1, z1, vx1, vy1, vz1], [x2, y2, z2, vx2, vy2, vz2], halfExtent, mass, restitution, iterations) => {
          const body1: Body = { kind: 'dynamic', vx: vx1, vy: vy1, vz: vz1, x: x1, y: CentreY(y1), z: z1 }
          const body2: Body = { kind: 'dynamic', vx: vx2, vy: vy2, vz: vz2, x: x2, y: CentreY(y2), z: z2 }
          const first = entityOf('first', body1, { halfHeight: HalfHeight(halfExtent), halfWidth: halfExtent, mass })
          const second = entityOf('second', body2, { halfHeight: HalfHeight(halfExtent), halfWidth: halfExtent, mass })

          const result = resolveEntityCollisions([first, second], { cellSize: 2, iterations, restitution })
          if (result.collisions.length > 0) {
            collidedAtLeastOnce = true
          }

          const resolvedFirst = result.entities[0]!.body
          const resolvedSecond = result.entities[1]!.body
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
