import { describe, expect, it } from 'vitest'
import {
  CentreY,
  detectEntityCollisions,
  HalfHeight,
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
