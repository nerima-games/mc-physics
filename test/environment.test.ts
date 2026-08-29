import { describe, expect, it } from 'vitest'
import { type BlockType } from '@nerima-games/mc-kernel'
import {
  CACTUS_SHAPE,
  CentreY,
  entityAABB,
  HalfHeight,
  PRESSURE_PLATE_SHAPE,
  type AABB,
  type Body,
  type BlockEnvironment,
  applySurfaceMotion,
  blockAABB,
  sampleBlockHazards,
  sampleFluidEffects,
  sampleSurfaceEffects,
  vec3,
} from '../src/index'
import { sampleOf } from './helpers/kernel-block'

const keyOf = (bx: number, by: number, bz: number): string => `${bx}:${by}:${bz}`

const environmentOf = (
  blocks: Readonly<Record<string, BlockType>>,
  blockShapeAt?: BlockEnvironment['blockShapeAt'],
): BlockEnvironment => ({
  blockAt: (bx, by, bz) => {
    const type = blocks[keyOf(bx, by, bz)]
    return type === undefined ? null : sampleOf(type)
  },
  ...(blockShapeAt ? { blockShapeAt } : {}),
})

const bodyBox = (
  y: number,
  halfWidth = 0.5,
  halfHeight = 0.5,
): AABB => entityAABB(0.5, CentreY(y), 0.5, halfWidth, HalfHeight(halfHeight))

const bodyOf = (kind: Body['kind'] = 'dynamic'): Body => ({
  kind,
  x: 0.5,
  y: CentreY(1.5),
  z: 0.5,
  vx: 2,
  vy: 3,
  vz: -4,
})

describe('environment material sampling', () => {
  it('reads surface effects from mc-kernel properties and accepts authoritative shapes', () => {
    const stone = sampleOf('stone')
    const environment = environmentOf({ [keyOf(0, 0, 0)]: 'stone' })
    expect(sampleSurfaceEffects(bodyBox(1.5), environment)).toEqual({
      friction: stone.properties.friction,
      movementDrag: stone.properties.movementDrag,
    })

    const customShapeEnvironment = environmentOf(
      { [keyOf(0, 0, 0)]: 'stone' },
      () => PRESSURE_PLATE_SHAPE,
    )
    expect(sampleSurfaceEffects(bodyBox(0.5625), customShapeEnvironment)).toEqual({
      friction: stone.properties.friction,
      movementDrag: stone.properties.movementDrag,
    })
    const compoundShapeEnvironment = environmentOf(
      { [keyOf(0, 0, 0)]: 'stone' },
      () => [
        { minX: 0, minY: 0, minZ: 0, maxX: 0.2, maxY: 1, maxZ: 1 },
        { minX: 0.5, minY: 0, minZ: 0, maxX: 0.75, maxY: 1, maxZ: 1 },
      ],
    )
    expect(sampleSurfaceEffects(bodyBox(1.5, 0.1), compoundShapeEnvironment)).toEqual({
      friction: stone.properties.friction,
      movementDrag: stone.properties.movementDrag,
    })
    expect(sampleSurfaceEffects(bodyBox(1.5), environmentOf({}))).toEqual({ friction: 1, movementDrag: 0 })

    const cobweb = sampleOf('cobweb')
    expect(sampleSurfaceEffects(bodyBox(1.5), environmentOf({ [keyOf(0, 1, 0)]: 'cobweb' }))).toEqual({
      friction: 1,
      movementDrag: cobweb.properties.movementDrag,
    })
  })

  it('applies only dynamic surface motion and sanitizes external coefficients', () => {
    const effects = { friction: 0.5, movementDrag: 0.8 }
    const dynamic = applySurfaceMotion(bodyOf(), effects)
    expect(dynamic.vx).toBeCloseTo(0.2)
    expect(dynamic.vz).toBeCloseTo(-0.4)
    const staticBody = bodyOf('static')
    const kinematicBody = bodyOf('kinematic')
    expect(applySurfaceMotion(staticBody, effects)).toBe(staticBody)
    expect(applySurfaceMotion(kinematicBody, effects)).toBe(kinematicBody)
    expect(applySurfaceMotion(bodyOf(), { friction: Number.NaN, movementDrag: Number.POSITIVE_INFINITY })).toEqual({
      ...bodyOf(),
      vx: 0,
      vz: -0,
    })
  })
})

describe('environment hazards', () => {
  it('uses kernel contact damage, suffocation, and climbable capabilities', () => {
    const cactus = sampleOf('cactus')
    expect(sampleBlockHazards(bodyBox(1.5), environmentOf({ [keyOf(0, 1, 0)]: 'cactus' }))).toEqual({
      contactDamage: cactus.properties.contactDamage,
      suffocating: cactus.capabilities.suffocates,
      climbable: cactus.capabilities.climbable,
    })

    const stone = sampleOf('stone')
    expect(sampleBlockHazards(bodyBox(1.5), environmentOf({ [keyOf(0, 1, 0)]: 'stone' }))).toEqual({
      contactDamage: 0,
      suffocating: stone.capabilities.suffocates,
      climbable: stone.capabilities.climbable,
    })

    const ladder = sampleOf('ladder')
    expect(sampleBlockHazards(bodyBox(1.5), environmentOf({ [keyOf(0, 1, 0)]: 'ladder' }))).toEqual({
      contactDamage: ladder.properties.contactDamage,
      suffocating: ladder.capabilities.suffocates,
      climbable: ladder.capabilities.climbable,
    })

    const lava = sampleOf('lava')
    expect(sampleBlockHazards(bodyBox(1.5), environmentOf({ [keyOf(0, 1, 0)]: 'lava' }))).toEqual({
      contactDamage: lava.properties.contactDamage,
      suffocating: lava.capabilities.suffocates,
      climbable: lava.capabilities.climbable,
    })
  })

  it('keeps contact effects when a custom shape removes collision geometry', () => {
    expect(sampleBlockHazards(
      bodyBox(1.5),
      environmentOf({ [keyOf(0, 1, 0)]: 'cactus' }, () => null),
    )).toEqual({ contactDamage: 1, suffocating: false, climbable: false })
    expect(sampleBlockHazards(
      bodyBox(1.5),
      environmentOf({ [keyOf(0, 1, 0)]: 'cactus' }, () => CACTUS_SHAPE),
    ).contactDamage).toBe(1)
    expect(sampleBlockHazards(
      { minX: 0, minY: 1.5, minZ: 0, maxX: 0.25, maxY: 1.75, maxZ: 0.25 },
      environmentOf({ [keyOf(0, 1, 0)]: 'cactus' }, () => ({
        minX: 0.75,
        minY: 0,
        minZ: 0.75,
        maxX: 1,
        maxY: 1,
        maxZ: 1,
      })),
    )).toEqual({ contactDamage: 1, suffocating: false, climbable: false })
    expect(sampleBlockHazards(
      { minX: 0.5, minY: 1, minZ: 0.25, maxX: 1, maxY: 2, maxZ: 0.75 },
      environmentOf({ [keyOf(1, 1, 0)]: 'cactus' }, () => ({
        minX: -1,
        minY: 0,
        minZ: 0,
        maxX: 0,
        maxY: 1,
        maxZ: 1,
      })),
    ).contactDamage).toBe(1)
    const stone = sampleOf('stone')
    expect(sampleBlockHazards(
      bodyBox(1.5, 0.1),
      environmentOf({ [keyOf(0, 1, 0)]: 'stone' }, () => [
        { minX: 0, minY: 0, minZ: 0, maxX: 0.2, maxY: 1, maxZ: 1 },
        { minX: 0.5, minY: 0, minZ: 0, maxX: 0.75, maxY: 1, maxZ: 1 },
      ]),
    )).toEqual({
      contactDamage: 0,
      suffocating: stone.capabilities.suffocates,
      climbable: stone.capabilities.climbable,
    })
  })
})

describe('fluid sampling', () => {
  const fluidBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }

  it('returns zero for a degenerate body volume', () => {
    expect(sampleFluidEffects(
      { ...fluidBox, maxY: 0 },
      environmentOf({ [keyOf(0, 0, 0)]: 'water' }),
      () => ({ level: 1, flow: vec3(1, 2, 3) }),
    )).toEqual({ waterVolume: 0, lavaVolume: 0, flow: vec3(0, 0, 0) })
  })

  it('combines water and lava volumes and averages finite flow', () => {
    const box: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 1, maxZ: 1 }
    const effects = sampleFluidEffects(
      box,
      environmentOf({
        [keyOf(0, 0, 0)]: 'water',
        [keyOf(1, 0, 0)]: 'lava',
      }),
      (bx, _by, _bz, kind) => {
        if (kind === 'water') {
          return { level: 2, flow: vec3(2, Number.NaN, 0) }
        }
        if (bx === 1) {
          return { level: 0.5, flow: vec3(0, 1, Number.POSITIVE_INFINITY) }
        }
        return null
      },
    )
    expect(effects.waterVolume).toBeCloseTo(0.5)
    expect(effects.lavaVolume).toBeCloseTo(0.25)
    expect(effects.flow.x).toBeCloseTo(4 / 3)
    expect(effects.flow.y).toBeCloseTo(1 / 3)
    expect(effects.flow.z).toBe(0)
  })

  it('skips absent, non-fluid, empty, and non-overlapping fluid cells', () => {
    const effects = sampleFluidEffects(
      fluidBox,
      environmentOf({
        [keyOf(0, 0, 0)]: 'water',
        [keyOf(1, 0, 0)]: 'water',
        [keyOf(0, 0, 1)]: 'stone',
      }),
      (bx, _by, bz) => {
        if (bx === 0 && bz === 0) {
          return { level: 1, flow: vec3(0, 0, 0) }
        }
        if (bx === 1) {
          return { level: 1, flow: vec3(1, 0, 0) }
        }
        return null
      },
    )
    expect(effects).toEqual({ waterVolume: 1, lavaVolume: 0, flow: vec3(0, 0, 0) })
    expect(sampleFluidEffects(
      fluidBox,
      environmentOf({ [keyOf(0, 0, 0)]: 'water' }),
      () => ({ level: 0, flow: vec3(1, 0, 0) }),
    )).toEqual({ waterVolume: 0, lavaVolume: 0, flow: vec3(0, 0, 0) })
    expect(sampleFluidEffects(
      fluidBox,
      environmentOf({ [keyOf(0, 0, 0)]: 'water' }),
      () => null,
    )).toEqual({ waterVolume: 0, lavaVolume: 0, flow: vec3(0, 0, 0) })
  })
})

describe('kernel collision-shape projection', () => {
  it('uses the shape supplied by the kernel when no world override exists', () => {
    const cactus = sampleOf('cactus')
    const environment = environmentOf({ [keyOf(0, 0, 0)]: 'cactus' })
    expect(blockAABB(0, 0, 0, CACTUS_SHAPE)).toEqual({
      minX: 0.0625,
      minY: 0,
      minZ: 0.0625,
      maxX: 0.9375,
      maxY: 1,
      maxZ: 0.9375,
    })
    expect(cactus.properties.collisionShape).toBe('cactus')
    expect(sampleSurfaceEffects(bodyBox(1.5), environment)).toEqual({
      friction: cactus.properties.friction,
      movementDrag: cactus.properties.movementDrag,
    })
  })
})
