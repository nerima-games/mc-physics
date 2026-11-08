import { AngleRadians, BlockId, PositionAxis } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BlocksPerSecond,
  BlocksPerSecondSquared,
  CentreY,
  DEFAULT_MOVEMENT_CONFIG,
  MovementFactor,
  applyKnockback as applyKnockbackResult,
  applyMovementFriction as applyMovementFrictionResult,
  applyMovementInput as applyMovementInputResult,
  movementCoefficientsForBlockId,
  velocityVectorResult,
  type Body,
  type MovementConfig,
  type MovementContext,
  type MovementInput,
  type VelocityVector,
} from '../src/index'
import {
  validateMovementBody,
  validateMovementConfig,
  validateMovementContext,
  validateMovementInput,
} from '../src/domain/movement'

const unwrapResult = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const applyMovementInput = (...args: Parameters<typeof applyMovementInputResult>): Body =>
  unwrapResult(applyMovementInputResult(...args))

const applyMovementFriction = (...args: Parameters<typeof applyMovementFrictionResult>): Body =>
  unwrapResult(applyMovementFrictionResult(...args))

const applyKnockback = (body: Body, impulse: VelocityVector): Body =>
  unwrapResult(applyKnockbackResult(body, impulse))

const velocity = (x: number, y: number, z: number): VelocityVector =>
  unwrapResult(velocityVectorResult(x, y, z))

const bodyOf = (kind: Body['kind'] = 'dynamic', overrides: Partial<Body> = {}): Body => ({
  kind,
  x: PositionAxis(0),
  y: CentreY(1),
  z: PositionAxis(0),
  vx: BlocksPerSecond(0),
  vy: BlocksPerSecond(0),
  vz: BlocksPerSecond(0),
  ...overrides,
})

const inputOf = (overrides: Partial<MovementInput> = {}): MovementInput => ({
  forward: 1,
  strafe: 0,
  yawRadians: AngleRadians(0),
  sprint: false,
  sneak: false,
  jumpPressed: false,
  ...overrides,
})

const contextOf = (overrides: Partial<MovementContext> = {}): MovementContext => ({
  isGrounded: true,
  inFluid: false,
  climbable: false,
  surfaceBlockId: null,
  movementBlockIds: [],
  ...overrides,
})

const EXPECTED_ORDINARY_WALK_STEADY_SPEED = 4.317180616740088
const EXPECTED_COBWEB_STEADY_SPEED = 1.079295154185022

const step = (
  body: Body,
  input: MovementInput,
  context: MovementContext,
  config: MovementConfig = DEFAULT_MOVEMENT_CONFIG,
): Body => {
  const afterInput = applyMovementInput(body, input, context, config)
  return applyMovementFriction(afterInput, input, context, config)
}

const speedAfterTicks = (
  input: MovementInput,
  context: MovementContext,
  ticks = 240,
): number => {
  let body = bodyOf()
  let speed = 0
  for (let tick = 0; tick < ticks; tick += 1) {
    const beforeMove = applyMovementInput(body, input, context)
    speed = -Number(beforeMove.vz)
    body = applyMovementFriction(beforeMove, input, context)
  }
  return speed
}

const isFiniteBody = (body: Body): boolean =>
  [body.x, body.y, body.z, body.vx, body.vy, body.vz].every((component) => Number.isFinite(Number(component)))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isResultLike = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  const tag = Reflect.get(value, '_tag')
  if (tag === 'Failure') return Reflect.has(value, 'failure')
  return tag === 'Success' && Reflect.has(value, 'success')
}

const isFiniteBodyValue = (value: unknown): boolean =>
  isRecord(value) && ['x', 'y', 'z', 'vx', 'vy', 'vz'].every((axis) =>
    typeof value[axis] === 'number' && Number.isFinite(value[axis]),
  )

const isFailureOrFiniteBody = (value: unknown): boolean => {
  if (!isRecord(value) || !isResultLike(value)) return false
  if (Reflect.get(value, '_tag') === 'Failure') return Reflect.get(value, 'failure') !== undefined
  return isFiniteBodyValue(Reflect.get(value, 'success'))
}

const boundedNumberArbitrary = fc.integer({ min: -10000, max: 10000 }).map((value) => value / 100)
const nonNegativeNumberArbitrary = fc.integer({ min: 0, max: 10000 }).map((value) => value / 100)
const validBlockIdArbitrary = fc.constantFrom(BlockId(18), BlockId(19), BlockId(47), BlockId(48))
const movementBodyArbitrary = fc.record({
  kind: fc.constantFrom<Body['kind']>('dynamic', 'static', 'kinematic'),
  x: boundedNumberArbitrary,
  y: boundedNumberArbitrary,
  z: boundedNumberArbitrary,
  vx: boundedNumberArbitrary,
  vy: boundedNumberArbitrary,
  vz: boundedNumberArbitrary,
}).map(({ kind, x, y, z, vx, vy, vz }): Body => ({
  kind,
  x: PositionAxis(x),
  y: CentreY(y),
  z: PositionAxis(z),
  vx: BlocksPerSecond(vx),
  vy: BlocksPerSecond(vy),
  vz: BlocksPerSecond(vz),
}))
const movementInputArbitrary = fc.record({
  forward: boundedNumberArbitrary,
  strafe: boundedNumberArbitrary,
  yawRadians: boundedNumberArbitrary,
  sprint: fc.boolean(),
  sneak: fc.boolean(),
  jumpPressed: fc.boolean(),
})
const movementContextArbitrary = fc.record({
  isGrounded: fc.boolean(),
  inFluid: fc.boolean(),
  climbable: fc.boolean(),
  surfaceBlockId: fc.oneof(fc.constant(null), validBlockIdArbitrary),
  movementBlockIds: fc.array(validBlockIdArbitrary),
})
const movementConfigArbitrary = fc.record({
  airAcceleration: nonNegativeNumberArbitrary.map(BlocksPerSecondSquared),
  climbDescentMaxSpeed: nonNegativeNumberArbitrary.map(BlocksPerSecond),
  climbSpeed: nonNegativeNumberArbitrary.map(BlocksPerSecond),
  fluidAscentAcceleration: nonNegativeNumberArbitrary.map(BlocksPerSecondSquared),
  fluidAscentMaxSpeed: nonNegativeNumberArbitrary.map(BlocksPerSecond),
  groundAcceleration: nonNegativeNumberArbitrary.map(BlocksPerSecondSquared),
  jumpVelocity: nonNegativeNumberArbitrary.map(BlocksPerSecond),
  sneakMultiplier: nonNegativeNumberArbitrary.map(MovementFactor),
  sprintMultiplier: nonNegativeNumberArbitrary.map(MovementFactor),
})

describe('single-tick movement input', () => {
  it('adds vanilla ground acceleration before integration and applies friction separately afterward', () => {
    const input = inputOf()
    const context = contextOf()
    const afterInput = applyMovementInput(bodyOf(), input, context)
    expect(afterInput.vz).toBeCloseTo(-1.96)

    const afterFriction = applyMovementFriction(afterInput, input, context)
    expect(afterFriction.vz).toBeCloseTo(-1.96 * 0.546)
  })

  it('normalizes diagonal movement, rotates by yaw, and clamps finite axes to their input bounds', () => {
    const diagonal = applyMovementInput(
      bodyOf(),
      inputOf({ forward: 2, strafe: 2 }),
      contextOf(),
    )
    expect(Number(diagonal.vx)).toBeCloseTo(1.96 / Math.sqrt(2))
    expect(Number(diagonal.vz)).toBeCloseTo(-1.96 / Math.sqrt(2))

    const rotated = applyMovementInput(
      bodyOf(),
      inputOf({ yawRadians: AngleRadians(Math.PI / 2) }),
      contextOf(),
    )
    expect(Number(rotated.vx)).toBeCloseTo(-1.96)
    expect(Number(rotated.vz)).toBeCloseTo(0)
  })

  it('uses separate air acceleration and does not jump away from the ground', () => {
    const airborne = applyMovementInput(
      bodyOf(),
      inputOf({ jumpPressed: true }),
      contextOf({ isGrounded: false }),
    )
    expect(Number(airborne.vz)).toBeCloseTo(-0.4)
    expect(airborne.vy).toBe(0)
  })

  it('applies sprint and sneak multipliers, with sneak taking precedence over sprint', () => {
    const walk = speedAfterTicks(inputOf(), contextOf())
    const sprint = speedAfterTicks(inputOf({ sprint: true }), contextOf())
    const sneak = speedAfterTicks(inputOf({ sprint: true, sneak: true }), contextOf())

    expect(walk).toBeCloseTo(4.317, 2)
    expect(sprint).toBeCloseTo(5.612, 2)
    expect(sneak).toBeCloseTo(1.295, 2)
  })

  it('keeps acceleration continuous when reversing and friction decays input-free velocity', () => {
    const reversed = applyMovementInput(
      bodyOf('dynamic', { vz: BlocksPerSecond(-1) }),
      inputOf(),
      contextOf(),
    )
    expect(Number(reversed.vz)).toBeCloseTo(-2.96)

    const decayed = applyMovementFriction(
      bodyOf('dynamic', { vx: BlocksPerSecond(10), vz: BlocksPerSecond(-10) }),
      inputOf({ forward: 0 }),
      contextOf(),
    )
    expect(Number(decayed.vx)).toBeCloseTo(5.46)
    expect(Number(decayed.vz)).toBeCloseTo(-5.46)
  })

  it('does not cross zero when the air input acceleration exactly cancels velocity', () => {
    const actual = applyMovementInput(
      bodyOf('dynamic', { vz: BlocksPerSecond(0.4) }),
      inputOf(),
      contextOf({ isGrounded: false }),
    )
    expect(actual.vz).toBe(0)
  })

  it('returns authored bodies unchanged after validating the stage inputs', () => {
    const input = inputOf()
    const context = contextOf()
    const staticBody = bodyOf('static')
    const kinematicBody = bodyOf('kinematic')
    expect(applyMovementInput(staticBody, input, context)).toBe(staticBody)
    expect(applyMovementFriction(kinematicBody, input, context)).toBe(kinematicBody)

    const badInput = { ...input, forward: Number.NaN }
    expect(Result.isFailure(applyMovementInputResult(
      staticBody,
      badInput,
      context,
    ))).toBe(true)
  })
})

describe('surface movement profiles', () => {
  it('uses ice slipperiness and the vanilla friction-adjusted acceleration recurrence', () => {
    const ice = contextOf({ surfaceBlockId: BlockId(48) })
    expect(speedAfterTicks(inputOf(), ice)).toBeCloseTo(4.157, 2)
  })

  it('uses soul-sand input slowdown without changing the ground friction recurrence', () => {
    const soulSand = contextOf({
      surfaceBlockId: BlockId(47),
      movementBlockIds: [BlockId(47)],
    })
    expect(speedAfterTicks(inputOf(), soulSand)).toBeCloseTo(2.508, 2)
  })

  it('settles at 3 blocks per second on a ladder under the input and friction recurrence', () => {
    const ladder = contextOf({
      isGrounded: false,
      movementBlockIds: [BlockId(18)],
    })
    const ladderFriction = 0.98 * 0.91

    expect(speedAfterTicks(inputOf(), ladder)).toBeCloseTo(3, 8)

    // A steady tick starts at the previous post-friction velocity, then moves at 3 blocks/second.
    const afterPreviousFriction = bodyOf('dynamic', {
      vz: BlocksPerSecond(-3 * ladderFriction),
    })
    const beforeMovement = applyMovementInput(afterPreviousFriction, inputOf(), ladder)
    expect(Number(beforeMovement.vz)).toBeCloseTo(-3, 12)

    const afterFriction = applyMovementFriction(beforeMovement, inputOf(), ladder)
    expect(Number(afterFriction.vz)).toBeCloseTo(-3 * ladderFriction, 12)
  })

  it('property: ladder horizontal velocity follows the analytic fixed-tick recurrence', () => {
    const tickCount = 12
    const ladderFriction = 0.98 * 0.91
    const ladder = contextOf({
      isGrounded: false,
      movementBlockIds: [BlockId(18)],
    })
    const forwardAxis = fc.integer({ min: -100, max: 100 }).map((value) => value / 100)

    fc.assert(
      fc.property(forwardAxis, (axis) => {
        const actual = speedAfterTicks(inputOf({ forward: axis }), ladder, tickCount)
        const expected = 3 * axis * (1 - ladderFriction ** tickCount)
        return Math.abs(actual - expected) < 1e-10
      }),
      { numRuns: 250 },
    )
  })

  it('sustains cobweb horizontal movement at one quarter of ordinary grounded walking speed', () => {
    const ticksPerSecond = 20
    const groundAccelerationPerTick = 39.2 / ticksPerSecond
    const ordinaryGroundFriction = 0.546
    const ordinaryWalkSteadySpeed = groundAccelerationPerTick / (1 - ordinaryGroundFriction)
    const cobweb = contextOf({ movementBlockIds: [BlockId(19)] })
    const ordinarySpeed = speedAfterTicks(inputOf(), contextOf())
    const cobwebSpeed = speedAfterTicks(inputOf(), cobweb)

    expect(ordinaryWalkSteadySpeed).toBeCloseTo(EXPECTED_ORDINARY_WALK_STEADY_SPEED, 8)
    expect(ordinaryWalkSteadySpeed * 0.25).toBeCloseTo(EXPECTED_COBWEB_STEADY_SPEED, 8)
    expect(ordinarySpeed).toBeCloseTo(EXPECTED_ORDINARY_WALK_STEADY_SPEED, 8)
    expect(cobwebSpeed).toBeCloseTo(EXPECTED_COBWEB_STEADY_SPEED, 8)
  })

  it('applies cobweb horizontal and vertical momentum multipliers to contacting entities', () => {
    const web = contextOf({
      isGrounded: false,
      movementBlockIds: [BlockId(19)],
    })
    const decayed = applyMovementFriction(
      bodyOf('dynamic', {
        vx: BlocksPerSecond(4),
        vy: BlocksPerSecond(4),
      }),
      inputOf({ forward: 0 }),
      web,
    )
    expect(Number(decayed.vx)).toBeCloseTo(4 * 0.91 * 0.25)
    expect(Number(decayed.vy)).toBeCloseTo(4 * 0.05)
  })

  it('exposes stable block coefficients for ladder, cobweb, soul sand, and ice IDs', () => {
    const ladder = unwrapResult(movementCoefficientsForBlockId(BlockId(18)))
    const web = unwrapResult(movementCoefficientsForBlockId(BlockId(19)))
    const soulSand = unwrapResult(movementCoefficientsForBlockId(BlockId(47)))
    const ice = unwrapResult(movementCoefficientsForBlockId(BlockId(48)))
    const unlistedBlock = unwrapResult(movementCoefficientsForBlockId(BlockId(0)))

    expect(ladder.climbable).toBe(true)
    expect(Number(web.horizontalMomentumMultiplier)).toBe(0.25)
    expect(Number(web.verticalMomentumMultiplier)).toBe(0.05)
    expect(Number(soulSand.inputAccelerationMultiplier)).toBeCloseTo(2.508 / 4.317)
    expect(Number(ice.groundSlipperiness)).toBe(0.98)
    expect(Number(unlistedBlock.groundSlipperiness)).toBe(0.6)
  })
})

describe('fluid and climbable movement', () => {
  it('preserves fluid ascent acceleration and caps it at the configured speed', () => {
    const input = inputOf({ forward: 0, jumpPressed: true })
    const water = contextOf({ isGrounded: false, inFluid: true })
    const firstTick = applyMovementInput(bodyOf(), input, water)
    expect(Number(firstTick.vy)).toBeCloseTo(0.04)

    let body = bodyOf()
    for (let tick = 0; tick < 100; tick += 1) {
      body = step(body, input, water)
    }
    expect(body.vy).toBe(DEFAULT_MOVEMENT_CONFIG.fluidAscentMaxSpeed)
  })

  it('jumps from ground and keeps airborne jump input from resetting vertical velocity', () => {
    const jump = applyMovementInput(
      bodyOf(),
      inputOf({ forward: 0, jumpPressed: true }),
      contextOf(),
    )
    expect(jump.vy).toBe(DEFAULT_MOVEMENT_CONFIG.jumpVelocity)

    const airborne = applyMovementInput(
      bodyOf('dynamic', { vy: BlocksPerSecond(0.5) }),
      inputOf({ forward: 0, jumpPressed: true }),
      contextOf({ isGrounded: false }),
    )
    expect(airborne.vy).toBe(BlocksPerSecond(0.5))
  })

  it('climbs ladders and vine-like contacts, caps descent, and holds when sneaking', () => {
    const ladder = contextOf({
      isGrounded: false,
      movementBlockIds: [BlockId(18)],
    })
    const up = step(bodyOf(), inputOf({ forward: 0, jumpPressed: true }), ladder)
    expect(Number(up.vy)).toBeCloseTo(2.35)

    const horizontal = applyMovementInput(bodyOf(), inputOf(), ladder)
    expect(Number(horizontal.vz)).toBeLessThan(0)

    const idle = step(bodyOf(), inputOf({ forward: 0 }), ladder)
    expect(idle.vy).toBe(0)

    const backpedaling = step(bodyOf(), inputOf({ forward: -1 }), ladder)
    expect(backpedaling.vy).toBe(0)

    const cappedFall = step(
      bodyOf('dynamic', { vy: BlocksPerSecond(-20) }),
      inputOf({ forward: -1 }),
      ladder,
    )
    expect(Number(cappedFall.vy)).toBe(-3)

    const held = step(
      bodyOf('dynamic', { vy: BlocksPerSecond(-1) }),
      inputOf({ forward: -1, sneak: true }),
      ladder,
    )
    expect(held.vy).toBe(0)

    const vine = contextOf({ isGrounded: false, climbable: true })
    const vineUp = step(bodyOf(), inputOf({ forward: 0, jumpPressed: true }), vine)
    expect(Number(vineUp.vy)).toBeCloseTo(2.35)
  })

  it('keeps zero configured climbable horizontal acceleration at zero', () => {
    const config: MovementConfig = {
      ...DEFAULT_MOVEMENT_CONFIG,
      groundAcceleration: BlocksPerSecondSquared(0),
    }
    const body = applyMovementInput(
      bodyOf(),
      inputOf(),
      contextOf({ climbable: true }),
      config,
    )

    expect(body.vx).toBe(0)
    expect(body.vz).toBe(0)
  })
})

describe('movement input validation', () => {
  it('rejects malformed raw bodies, controls, contexts, and configuration values', () => {
    expect(Result.isFailure(validateMovementBody(null))).toBe(true)
    expect(Result.isFailure(validateMovementBody({ kind: 'flying' }))).toBe(true)

    const invalidBody = bodyOf()
    Object.defineProperty(invalidBody, 'x', { value: Number.NaN })
    expect(Result.isFailure(validateMovementBody(invalidBody))).toBe(true)
    expect(Result.isFailure(applyMovementInputResult(invalidBody, inputOf(), contextOf()))).toBe(true)
    expect(Result.isFailure(applyMovementFrictionResult(invalidBody, inputOf(), contextOf()))).toBe(true)

    expect(Result.isFailure(validateMovementInput(null))).toBe(true)
    const invalidButtons = inputOf()
    Object.defineProperty(invalidButtons, 'sprint', { value: 'fast' })
    expect(Result.isFailure(validateMovementInput(invalidButtons))).toBe(true)

    expect(Result.isFailure(validateMovementContext(null))).toBe(true)
    expect(Result.isFailure(validateMovementContext({ ...contextOf(), isGrounded: 'yes' }))).toBe(true)
    expect(Result.isFailure(validateMovementContext({ ...contextOf(), movementBlockIds: null }))).toBe(true)

    expect(Result.isFailure(validateMovementConfig(null))).toBe(true)
    expect(Result.isFailure(validateMovementConfig({
      ...DEFAULT_MOVEMENT_CONFIG,
      groundAcceleration: 'fast',
    }))).toBe(true)
    expect(Result.isFailure(MovementFactor.result(-1))).toBe(true)
  })

  it('returns typed failures for malformed controls, IDs, and configuration', () => {
    const body = bodyOf()
    const input = inputOf()
    const context = contextOf()

    expect(Result.isFailure(applyMovementInputResult(
      body,
      { ...input, strafe: Number.POSITIVE_INFINITY },
      context,
    ))).toBe(true)
    expect(Result.isFailure(applyMovementInputResult(
      body,
      { ...input, yawRadians: Number.NaN },
      context,
    ))).toBe(true)

    const invalidContext = { ...context, movementBlockIds: ['ladder'] }
    expect(Result.isFailure(validateMovementContext(invalidContext))).toBe(true)

    const invalidConfig = {
      ...DEFAULT_MOVEMENT_CONFIG,
      groundAcceleration: BlocksPerSecondSquared(-1),
    }
    expect(Result.isFailure(applyMovementInputResult(
      body,
      input,
      context,
      invalidConfig,
    ))).toBe(true)
    expect(Result.isFailure(movementCoefficientsForBlockId('ladder'))).toBe(true)
  })

  it('property: arbitrary stage inputs never throw and succeed only with finite bodies', () => {
    fc.assert(
      fc.property(movementBodyArbitrary, movementInputArbitrary, movementContextArbitrary, movementConfigArbitrary,
        (body, input, context, config) => {
        const movementResult = applyMovementInputResult(body, input, context, config)
        const frictionResult = applyMovementFrictionResult(body, input, context, config)
        return [movementResult, frictionResult].every((result) =>
          Result.isFailure(result) || isFiniteBody(result.success),
        )
      }),
      { numRuns: 250 },
    )
  })

  it('property: BlockId lookup either fails validation or returns finite coefficients', () => {
    fc.assert(
      fc.property(fc.anything(), (rawBlockId) => {
        const result = movementCoefficientsForBlockId(rawBlockId)
        return Result.isFailure(result) || [
          result.success.groundSlipperiness,
          result.success.inputAccelerationMultiplier,
          result.success.horizontalMomentumMultiplier,
          result.success.verticalMomentumMultiplier,
        ].every((coefficient) => Number.isFinite(Number(coefficient)))
      }),
      { numRuns: 250 },
    )
  })

  it('property: movement APIs return typed failures or finite bodies for arbitrary arguments', () => {
    fc.assert(
      fc.property(fc.array(fc.anything(), { maxLength: 4 }), (args) => {
        const movementResult = Reflect.apply(applyMovementInputResult, undefined, args)
        const frictionResult = Reflect.apply(applyMovementFrictionResult, undefined, args)
        return isFailureOrFiniteBody(movementResult) && isFailureOrFiniteBody(frictionResult)
      }),
      { numRuns: 250 },
    )
  })
})

describe('knockback', () => {
  it('adds finite impulse components only to dynamic bodies', () => {
    expect(applyKnockback(bodyOf(), velocity(1, -2, 3))).toEqual({
      ...bodyOf(),
      vx: BlocksPerSecond(1),
      vy: BlocksPerSecond(-2),
      vz: BlocksPerSecond(3),
    })

    expect(Result.isFailure(velocityVectorResult(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY))).toBe(true)
    const staticBody = bodyOf('static')
    expect(applyKnockback(staticBody, velocity(1, 2, 3))).toBe(staticBody)
  })

  it('rejects every invalid body component for dynamic, kinematic, and static bodies', () => {
    const bodyKinds: ReadonlyArray<Body['kind']> = ['dynamic', 'kinematic', 'static']
    const bodyComponents = ['x', 'y', 'z', 'vx', 'vy', 'vz'] as const
    const invalidNumbers = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

    for (const kind of bodyKinds) {
      for (const component of bodyComponents) {
        for (const invalidNumber of invalidNumbers) {
          const invalidBody = bodyOf(kind)
          expect(Reflect.set(invalidBody, component, invalidNumber)).toBe(true)
          expect(
            Result.isFailure(applyKnockbackResult(invalidBody, velocity(1, 2, 3))),
            `${kind} body with invalid ${component} should fail`,
          ).toBe(true)
        }
      }
    }

    const invalidKindBody = bodyOf()
    expect(Reflect.set(invalidKindBody, 'kind', 'unknown')).toBe(true)
    expect(Result.isFailure(applyKnockbackResult(invalidKindBody, velocity(1, 2, 3)))).toBe(true)
  })

  it('rejects every invalid impulse component for dynamic, kinematic, and static bodies', () => {
    const bodyKinds: ReadonlyArray<Body['kind']> = ['dynamic', 'kinematic', 'static']
    const impulseComponents = ['x', 'y', 'z'] as const
    const invalidNumbers = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

    for (const kind of bodyKinds) {
      for (const component of impulseComponents) {
        for (const invalidNumber of invalidNumbers) {
          const invalidImpulse = velocity(1, 2, 3)
          expect(Reflect.set(invalidImpulse, component, invalidNumber)).toBe(true)
          expect(
            Result.isFailure(applyKnockbackResult(bodyOf(kind), invalidImpulse)),
            `${kind} body with invalid impulse ${component} should fail`,
          ).toBe(true)
        }
      }
    }
  })

  it('accepts signed finite negative body velocities and impulses for every body kind', () => {
    const negativeFinite = fc.integer({ min: -100000, max: -1 }).map((value) => value / 100)
    fc.assert(
      fc.property(
        fc.constantFrom<Body['kind']>('dynamic', 'kinematic', 'static'),
        fc.tuple(negativeFinite, negativeFinite, negativeFinite),
        fc.tuple(negativeFinite, negativeFinite, negativeFinite),
        (kind, bodyVelocities, impulseComponents) => {
          const body = bodyOf(kind, {
            vx: BlocksPerSecond(bodyVelocities[0]),
            vy: BlocksPerSecond(bodyVelocities[1]),
            vz: BlocksPerSecond(bodyVelocities[2]),
          })
          const impulse = velocity(impulseComponents[0], impulseComponents[1], impulseComponents[2])
          const result = applyKnockbackResult(body, impulse)
          if (Result.isFailure(result)) return false
          if (kind !== 'dynamic') return result.success === body

          return Number(result.success.vx) === bodyVelocities[0] + impulseComponents[0]
            && Number(result.success.vy) === bodyVelocities[1] + impulseComponents[1]
            && Number(result.success.vz) === bodyVelocities[2] + impulseComponents[2]
        },
      ),
      { numRuns: 250 },
    )
  })
})
