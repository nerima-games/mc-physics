import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { BlockAxis, PositionAxis, type BlockType } from '@nerima-games/mc-kernel'
import {
  BlockLength,
  BlocksPerSecond,
  BlocksPerSecondSquared,
  CACTUS_SHAPE,
  CentreY,
  HalfHeight,
  PRESSURE_PLATE_SHAPE,
  type AABB,
  type Body,
  type BlockEnvironment,
  applySurfaceMotion as applySurfaceMotionResult,
  blockAABB as blockAABBResult,
  entityAABB as entityAABBResult,
  sampleBlockHazards as sampleBlockHazardsResult,
  sampleFluidEffects as sampleFluidEffectsResult,
  sampleSurfaceEffects as sampleSurfaceEffectsResult,
} from '../src/index'
import { DeltaTimeSecs } from '../src/domain/delta-time'
import { stepBody as stepBodyResult, type ResolveOptions } from '../src/domain/resolve'
import { sampleOf } from './helpers/kernel-block'

const keyOf = (bx: number, by: number, bz: number): string => `${bx}:${by}:${bz}`

const unwrapResult = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const entityAABB = (...args: Parameters<typeof entityAABBResult>): AABB =>
  unwrapResult(entityAABBResult(...args))

const blockAABB = (...args: Parameters<typeof blockAABBResult>): AABB =>
  unwrapResult(blockAABBResult(...args))

const sampleSurfaceEffects = (...args: Parameters<typeof sampleSurfaceEffectsResult>) =>
  unwrapResult(sampleSurfaceEffectsResult(...args))

const sampleBlockHazards = (...args: Parameters<typeof sampleBlockHazardsResult>) =>
  unwrapResult(sampleBlockHazardsResult(...args))

const sampleFluidEffects = (...args: Parameters<typeof sampleFluidEffectsResult>) =>
  unwrapResult(sampleFluidEffectsResult(...args))

const applySurfaceMotion = (...args: Parameters<typeof applySurfaceMotionResult>): Body =>
  unwrapResult(applySurfaceMotionResult(...args))

const aabb = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB => ({
  minX: PositionAxis(minX),
  minY: PositionAxis(minY),
  minZ: PositionAxis(minZ),
  maxX: PositionAxis(maxX),
  maxY: PositionAxis(maxY),
  maxZ: PositionAxis(maxZ),
})

const environmentOf = (
  blocks: Readonly<Record<string, BlockType>>,
  blockShapeAt?: BlockEnvironment['blockShapeAt'],
): BlockEnvironment => ({
  blockAt: (bx, by, bz) => {
    const type = blocks[keyOf(bx, by, bz)]
    return Result.succeed(type === undefined ? null : sampleOf(type))
  },
  ...(blockShapeAt ? { blockShapeAt } : {}),
})

const bodyBox = (
  y: number,
  halfWidth = 0.5,
  halfHeight = 0.5,
): AABB => entityAABB(PositionAxis(0.5), CentreY(y), PositionAxis(0.5), BlockLength(halfWidth), HalfHeight(halfHeight))

const bodyOf = (kind: Body['kind'] = 'dynamic'): Body => ({
  kind,
  x: PositionAxis(0.5),
  y: CentreY(1.5),
  z: PositionAxis(0.5),
  vx: BlocksPerSecond(2),
  vy: BlocksPerSecond(3),
  vz: BlocksPerSecond(-4),
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
        aabb(0, 0, 0, 0.2, 1, 1),
        aabb(0.5, 0, 0, 0.75, 1, 1),
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

  it('returns a failure for non-finite AABB coordinates', () => {
    const invalidBox: AABB = {
      ...bodyBox(1.5),
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      minX: Number.NaN,
    }
    const environment = environmentOf({})
    expect(Result.isFailure(sampleSurfaceEffectsResult(invalidBox, environment))).toBe(true)
    expect(Result.isFailure(sampleBlockHazardsResult(invalidBox, environment))).toBe(true)
  })

  it('propagates invalid support shapes and out-of-range drag scans', () => {
    const invertedShape = aabb(0.75, 0, 0, 0.25, 1, 1)
    const supportFailure = sampleSurfaceEffectsResult(
      bodyBox(1.5),
      environmentOf({ [keyOf(0, 0, 0)]: 'stone' }, () => invertedShape),
    )
    expect(Result.isFailure(supportFailure)).toBe(true)
    if (Result.isFailure(supportFailure)) expect(supportFailure.failure).toBeInstanceOf(RangeError)

    const outOfRangeDragBox: AABB = { ...bodyBox(1.5), maxY: PositionAxis(Number.MAX_VALUE) }
    expect(Result.isFailure(sampleSurfaceEffectsResult(outOfRangeDragBox, environmentOf({})))).toBe(true)
  })

  it('ignores movement drag from a block cell that only touches the AABB boundary', () => {
    const cobweb = sampleOf('cobweb')
    const effects = sampleSurfaceEffects(
      bodyBox(1.5),
      environmentOf({ [keyOf(1, 1, 0)]: 'cobweb' }),
    )

    expect(cobweb.properties.movementDrag).toBeGreaterThan(0)
    expect(effects.movementDrag).toBe(0)
  })

  it('applies only dynamic surface motion and rejects non-finite external coefficients', () => {
    const effects = { friction: 0.5, movementDrag: 0.8 }
    const dynamic = applySurfaceMotion(bodyOf(), effects)
    expect(dynamic.vx).toBeCloseTo(0.2)
    expect(dynamic.vz).toBeCloseTo(-0.4)
    const staticBody = bodyOf('static')
    const kinematicBody = bodyOf('kinematic')
    expect(applySurfaceMotion(staticBody, effects)).toBe(staticBody)
    expect(applySurfaceMotion(kinematicBody, effects)).toBe(kinematicBody)
    expect(Result.isFailure(applySurfaceMotionResult(bodyOf(), { friction: Number.NaN, movementDrag: Number.POSITIVE_INFINITY }))).toBe(true)
    const invalidBody: Body = {
      ...bodyOf(),
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      vx: Number.NaN,
    }
    expect(Result.isFailure(applySurfaceMotionResult(invalidBody, effects))).toBe(true)
  })
})

describe('vertical surface drag (FR-006: cobwebs, powder snow)', () => {
  it('leaves vy untouched when movementDragY is not specified, matching pre-FR-006 behaviour', () => {
    const effects = { friction: 0.5, movementDrag: 0.8 }
    const body = bodyOf()
    expect(applySurfaceMotion(body, effects).vy).toBe(body.vy)
  })

  it('applies movementDragY to vy independently of the horizontal friction/drag multiplier', () => {
    const effects = { friction: 0.5, movementDrag: 0.8, movementDragY: 0.25 }
    const actual = applySurfaceMotion(bodyOf(), effects)
    expect(actual.vy).toBeCloseTo(bodyOf().vy * 0.75)
    expect(actual.vx).toBeCloseTo(0.2)
    expect(actual.vz).toBeCloseTo(-0.4)
  })

  it('returns a failure for null or non-finite movementDragY instead of using zero drag', () => {
    for (const movementDragY of [null, Number.POSITIVE_INFINITY]) {
      expect(Result.isFailure(applySurfaceMotionResult(bodyOf(), {
        friction: 1,
        movementDrag: 0,
        // @ts-expect-error Exercise runtime rejection of explicit null or infinity.
        movementDragY,
      }))).toBe(true)
    }
  })

  it('property: movementDragY in (0, 1] never increases |vy|, and omitting it leaves vy exactly unchanged', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-9, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (dragY, vy) => {
          const body = { ...bodyOf(), vy: BlocksPerSecond(vy) }
          const decayed = applySurfaceMotion(body, { friction: 1, movementDrag: 0, movementDragY: dragY })
          const untouched = applySurfaceMotion(body, { friction: 1, movementDrag: 0 })
          return Math.abs(decayed.vy) <= Math.abs(vy) + 1e-9 && untouched.vy === vy
        },
      ),
      { numRuns: 200 },
    )
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
      aabb(0, 1.5, 0, 0.25, 1.75, 0.25),
      environmentOf({ [keyOf(0, 1, 0)]: 'cactus' }, () => aabb(0.75, 0, 0.75, 1, 1, 1)),
    )).toEqual({ contactDamage: 1, suffocating: false, climbable: false })
    expect(sampleBlockHazards(
      aabb(0.5, 1, 0.25, 1, 2, 0.75),
      environmentOf({ [keyOf(1, 1, 0)]: 'cactus' }, () => aabb(-1, 0, 0, 0, 1, 1)),
    ).contactDamage).toBe(1)
    const stone = sampleOf('stone')
    expect(sampleBlockHazards(
      bodyBox(1.5, 0.1),
      environmentOf({ [keyOf(0, 1, 0)]: 'stone' }, () => [
        aabb(0, 0, 0, 0.2, 1, 1),
        aabb(0.5, 0, 0, 0.75, 1, 1),
      ]),
    )).toEqual({
      contactDamage: 0,
      suffocating: stone.capabilities.suffocates,
      climbable: stone.capabilities.climbable,
    })
  })

  it('propagates block lookup failures through environment sampling', () => {
    const invalidCoordinate = BlockAxis.result(Number.NaN)
    if (Result.isSuccess(invalidCoordinate)) throw new Error('Expected an invalid block coordinate')
    const failure = invalidCoordinate.failure
    const failedEnvironment: BlockEnvironment = { blockAt: () => Result.fail(failure) }
    const box = bodyBox(1.5)

    const expectLookupFailure = <A, E>(result: Result.Result<A, E>) => {
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) expect(result.failure).toBe(failure)
    }

    expectLookupFailure(sampleSurfaceEffectsResult(box, failedEnvironment))
    expectLookupFailure(sampleBlockHazardsResult(box, failedEnvironment))
    expectLookupFailure(sampleFluidEffectsResult(box, failedEnvironment, () => null))

    let calls = 0
    const dragFailureEnvironment: BlockEnvironment = {
      blockAt: () => {
        calls += 1
        return calls <= 8 ? Result.succeed(null) : Result.fail(failure)
      },
    }
    expectLookupFailure(sampleSurfaceEffectsResult(box, dragFailureEnvironment))
  })

  it('returns a Result failure when a sampled contact-damage brand is invalid', () => {
    const cactus = sampleOf('cactus')
    const invalidDamageSample: typeof cactus = {
      ...cactus,
      properties: {
        ...cactus.properties,
        // @ts-expect-error Exercise runtime rejection of a malformed kernel property value.
        contactDamage: Number.NaN,
      },
    }
    const environment: BlockEnvironment = { blockAt: () => Result.succeed(invalidDamageSample) }

    expect(Result.isFailure(sampleBlockHazardsResult(bodyBox(1.5), environment))).toBe(true)
  })

  it('samples hazards once from the post-collision AABB and returns them with the resolution', () => {
    const cells: Array<readonly [number, number, number]> = []
    const cactus = sampleOf('cactus')
    const environment: BlockEnvironment = {
      blockAt: (bx, by, bz) => {
        cells.push([bx, by, bz])
        return Result.succeed(bx === 1 && by === 1 && bz === 0 ? cactus : null)
      },
    }
    const stone = sampleOf('stone')
    const options: ResolveOptions = {
      halfWidth: BlockLength(0.25),
      halfHeight: HalfHeight(0.1),
      environment,
      blockPropertiesAt: (bx, by, bz) => Result.succeed(bx === 1 && by === 1 && bz === 0 ? stone.properties : null),
    }
    const body: Body = {
      ...bodyOf(),
      x: PositionAxis(0.5),
      y: CentreY(1.5),
      z: PositionAxis(0.5),
      vx: BlocksPerSecond(3),
      vy: BlocksPerSecond(0),
      vz: BlocksPerSecond(0),
    }

    const resolution = unwrapResult(stepBodyResult(
      body,
      DeltaTimeSecs(0.1),
      options,
      { gravityY: BlocksPerSecondSquared(0) },
    ))

    expect(resolution.body.x).toBe(0.75)
    expect(resolution.hazards).toEqual({
      contactDamage: cactus.properties.contactDamage,
      suffocating: cactus.capabilities.suffocates,
      climbable: cactus.capabilities.climbable,
    })
    expect(cells).toEqual([[0, 1, 0], [1, 1, 0]])
  })

  it('propagates a hazard sampling failure through the resolver result', () => {
    const cells: Array<readonly [number, number, number]> = []
    const invalidShape = aabb(0.75, 0, 0, 0.25, 1, 1)
    const cactus = sampleOf('cactus')
    const environment: BlockEnvironment = {
      blockAt: (bx, by, bz) => {
        cells.push([bx, by, bz])
        return Result.succeed(cactus)
      },
      blockShapeAt: () => invalidShape,
    }
    const options: ResolveOptions = {
      halfWidth: BlockLength(0.1),
      halfHeight: HalfHeight(0.1),
      environment,
      blockPropertiesAt: () => Result.succeed(null),
    }
    const stationary = {
      ...bodyOf(),
      vx: BlocksPerSecond(0),
      vy: BlocksPerSecond(0),
      vz: BlocksPerSecond(0),
    }
    const result = stepBodyResult(
      stationary,
      DeltaTimeSecs(0.1),
      options,
      { gravityY: BlocksPerSecondSquared(0) },
    )

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(RangeError)
    expect(cells).toEqual([[0, 1, 0]])
  })
})

describe('fluid sampling', () => {
  const fluidBox: AABB = aabb(0, 0, 0, 1, 1, 1)

  it('returns zero for a degenerate body volume', () => {
    expect(sampleFluidEffects(
      { ...fluidBox, maxY: PositionAxis(0) },
      environmentOf({ [keyOf(0, 0, 0)]: 'water' }),
      () => ({ level: 1, flow: { x: 1, y: 2, z: 3 } }),
    )).toEqual({ waterVolume: 0, lavaVolume: 0, flow: { x: 0, y: 0, z: 0 } })
  })

  it('returns a failure when a finite AABB span overflows', () => {
    const invalidBox: AABB = {
      ...fluidBox,
      minX: PositionAxis(-Number.MAX_VALUE),
      maxX: PositionAxis(Number.MAX_VALUE),
    }
    expect(Result.isFailure(sampleFluidEffectsResult(invalidBox, environmentOf({}), () => null))).toBe(true)
  })

  it('returns a failure when a valid fluid volume extends beyond the block-coordinate range', () => {
    const unscannableBox: AABB = { ...fluidBox, maxX: PositionAxis(Number.MAX_VALUE) }
    const result = sampleFluidEffectsResult(unscannableBox, environmentOf({}), () => null)

    expect(Result.isFailure(result)).toBe(true)
  })

  it('combines water and lava volumes and averages finite flow', () => {
    const box: AABB = aabb(0, 0, 0, 2, 1, 1)
    const effects = sampleFluidEffects(
      box,
      environmentOf({
        [keyOf(0, 0, 0)]: 'water',
        [keyOf(1, 0, 0)]: 'lava',
      }),
      (bx, _by, _bz, kind) => {
        if (kind === 'water') {
          return { level: 2, flow: { x: 2, y: Number.NaN, z: 0 } }
        }
        if (bx === 1) {
          return { level: 0.5, flow: { x: 0, y: 1, z: Number.POSITIVE_INFINITY } }
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
          return { level: 1, flow: { x: 0, y: 0, z: 0 } }
        }
        if (bx === 1) {
          return { level: 1, flow: { x: 1, y: 0, z: 0 } }
        }
        return null
      },
    )
    expect(effects).toEqual({ waterVolume: 1, lavaVolume: 0, flow: { x: 0, y: 0, z: 0 } })
    expect(sampleFluidEffects(
      fluidBox,
      environmentOf({ [keyOf(0, 0, 0)]: 'water' }),
      () => ({ level: 0, flow: { x: 1, y: 0, z: 0 } }),
    )).toEqual({ waterVolume: 0, lavaVolume: 0, flow: { x: 0, y: 0, z: 0 } })
    expect(sampleFluidEffects(
      fluidBox,
      environmentOf({ [keyOf(0, 0, 0)]: 'water' }),
      () => null,
    )).toEqual({ waterVolume: 0, lavaVolume: 0, flow: { x: 0, y: 0, z: 0 } })
  })
})

describe('kernel collision-shape projection', () => {
  it('uses the shape supplied by the kernel when no world override exists', () => {
    const cactus = sampleOf('cactus')
    const environment = environmentOf({ [keyOf(0, 0, 0)]: 'cactus' })
    expect(blockAABB(BlockAxis(0), BlockAxis(0), BlockAxis(0), CACTUS_SHAPE)).toEqual({
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
