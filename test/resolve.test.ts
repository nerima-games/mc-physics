/**
 * The AABB collision resolver.
 *
 * plan.md §3.4 asks for three property tests by name — energy non-increasing,
 * zero penetration, determinism — and `docs/design-notes.md` P-3 and P-6 name
 * two regressions that could not be written until there was a resolver to write
 * them against. Both are here.
 *
 * Regression names (docs/design-notes.md):
 *   physics-resolve-runs-after-integrate
 *   physics-resting-contact-is-not-a-collision
 *   physics-resolve-y-before-x
 *   physics-no-block-id-name-checks
 */
import { isDeepStrictEqual } from 'node:util'
import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
import { BlockAxis, PositionAxis, resolveBlockProperties, type BlockProperties, type CollisionShape } from '@nerima-games/mc-kernel'
import type { BlockEnvironment } from '../src/domain/environment-types'
import {
  CONTACT_EPSILON,
  CentreY,
  HalfHeight,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  blockAABB,
  centreOfFoot,
  collidesWith,
  entityAABB,
  intersects,
  isRestingOn,
  penetrationY,
  standingPlaneAbove,
  type AABB,
} from '../src/domain/coordinates'
import { CACTUS_SHAPE, PRESSURE_PLATE_SHAPE } from '../src/domain/shape-data'
import { BlockLength, BlocksPerSecond, BlocksPerSecondSquared } from '../src/domain/physical-units'
import { DeltaTimeSecs, MAX_DELTA_SECS, MIN_DELTA_SECS } from '../src/domain/delta-time'
import {
  GRAVITY_Y,
  TERMINAL_VELOCITY_Y,
  integrateBody as integrateBodyResult,
  maxFallPerStep as maxFallPerStepResult,
  type Body,
  type IntegrationOptions,
} from '../src/domain/integrate'
import {
  clampSneakEdge as clampSneakEdgeResult,
  maxSpeedWithoutTunnelling as maxSpeedWithoutTunnellingResult,
  resolveBody as resolveBodyResult,
  resolveWorld as resolveWorldResult,
  stepBody as stepBodyResult,
  stepWorld as stepWorldResult,
  type ResolveOptions,
} from '../src/domain/resolve'
import { clampAxis as clampAxisResult, resolveVertical as resolveVerticalResult } from '../src/domain/resolve-axis'
import { blockShapesAt as blockShapesAtResult, forEachCollidingBlock as forEachCollidingBlockResult } from '../src/domain/resolve-shapes'
import { isSupported as isSupportedResult, tryStepUp as tryStepUpResult } from '../src/domain/resolve-support'
import { resolveSweptMotion as resolveSweptMotionResult } from '../src/domain/resolve-sweep'
import { sampleOf } from './helpers/kernel-block'

const HALF_W = PLAYER_HALF_WIDTH
const HALF_H = PLAYER_HALF_HEIGHT
const DT = DeltaTimeSecs(MAX_DELTA_SECS)

type BodyInput = {
  readonly kind: Body['kind']
  readonly x: number
  readonly y: number
  readonly z: number
  readonly vx: number
  readonly vy: number
  readonly vz: number
}

type BodyOverrides = Partial<BodyInput>

type IntegrationInput = Omit<Partial<IntegrationOptions>, 'gravityY' | 'terminalVelocityY'> & {
  readonly gravityY?: number
  readonly terminalVelocityY?: number
}

type ResolveOptionsInput = Omit<Partial<ResolveOptions>, 'halfWidth' | 'halfHeight' | 'stepHeight'> & {
  readonly halfWidth?: number
  readonly halfHeight?: number
  readonly stepHeight?: number
}

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const bodyFrom = (body: BodyInput): Body => ({
  kind: body.kind,
  x: PositionAxis(body.x),
  y: CentreY(body.y),
  z: PositionAxis(body.z),
  vx: BlocksPerSecond(body.vx),
  vy: BlocksPerSecond(body.vy),
  vz: BlocksPerSecond(body.vz),
})

const integrationOptions = (options: IntegrationInput = {}): IntegrationOptions => {
  const { gravityY, terminalVelocityY, ...rest } = options
  return {
    ...rest,
    ...(gravityY === undefined ? {} : { gravityY: BlocksPerSecondSquared(gravityY) }),
    ...(terminalVelocityY === undefined ? {} : { terminalVelocityY: BlocksPerSecond(terminalVelocityY) }),
  }
}

const integrateBody = (body: BodyInput, delta: ReturnType<typeof DeltaTimeSecs>, options?: IntegrationInput): Body =>
  unwrap(integrateBodyResult(bodyFrom(body), delta, integrationOptions(options)))

const stepBody = (
  body: BodyInput,
  delta: ReturnType<typeof DeltaTimeSecs>,
  options: ResolveOptions,
  integration?: IntegrationInput,
) => unwrap(stepBodyResult(bodyFrom(body), delta, options, integrationOptions(integration)))

const resolveBody = (body: BodyInput, delta: ReturnType<typeof DeltaTimeSecs>, options: ResolveOptions) =>
  unwrap(resolveBodyResult(bodyFrom(body), delta, options))

const resolveWorld = (bodies: ReadonlyArray<BodyInput>, delta: ReturnType<typeof DeltaTimeSecs>, options: ResolveOptions) =>
  unwrap(resolveWorldResult(bodies.map(bodyFrom), delta, options))

const stepWorld = (
  bodies: ReadonlyArray<BodyInput>,
  delta: ReturnType<typeof DeltaTimeSecs>,
  options: ResolveOptions,
) => unwrap(stepWorldResult(bodies.map(bodyFrom), delta, options))

const maxFallPerStep = (delta: number) => unwrap(maxFallPerStepResult(DeltaTimeSecs(delta)))

const maxSpeedWithoutTunnelling = (halfExtent: number, blockThickness: number, delta: number) =>
  unwrap(maxSpeedWithoutTunnellingResult(BlockLength(halfExtent), BlockLength(blockThickness), DeltaTimeSecs(delta)))

const clampSneakEdge = (
  previous: { readonly x: number; readonly z: number },
  next: { readonly x: number; readonly z: number },
  hasGroundSupport: (x: number, z: number) => boolean,
) => clampSneakEdgeResult(
  { x: PositionAxis(previous.x), z: PositionAxis(previous.z) },
  { x: PositionAxis(next.x), z: PositionAxis(next.z) },
  hasGroundSupport,
)

type AxisInput = { readonly blocked: boolean; readonly position: number; readonly velocity: number }
const tryStepUp = (
  body: BodyInput,
  resolvedY: number,
  alongX: AxisInput,
  alongZ: AxisInput,
  verticalVelocity: number,
  options: ResolveOptions,
) => unwrap(tryStepUpResult(
  bodyFrom(body),
  CentreY(resolvedY),
  { ...alongX, position: PositionAxis(alongX.position), velocity: BlocksPerSecond(alongX.velocity) },
  { ...alongZ, position: PositionAxis(alongZ.position), velocity: BlocksPerSecond(alongZ.velocity) },
  BlocksPerSecond(verticalVelocity),
  options,
))

/**
 * The fastest the reference's player ever moves horizontally: a sprint (5.612)
 * times the sprint-jump multiplier (1.2), from
 * `packages/entity/application/movement-service.ts:25-32`. It lives here rather
 * than in `domain/` because it is a gameplay value and belongs to mc-sim
 * (`docs/responsibility.md` §3) — the resolver only needs to be safe at it.
 */
const REFERENCE_TOP_SPEED = 5.612 * 1.2

/** Solid everywhere up to and including `topCell`; air above. A world floor. */
type SolidPredicate = (bx: number, by: number, bz: number) => boolean

const groundUpTo =
  (topCell: number): SolidPredicate =>
  (_bx, by, _bz) =>
    by <= topCell

const FULL_BLOCK_PROPERTIES = unwrap(resolveBlockProperties({ collisionShape: 'full' }))
const EMPTY_ENVIRONMENT: BlockEnvironment = { blockAt: () => null }
const propertiesFor = (collisionShape: CollisionShape): BlockProperties =>
  unwrap(resolveBlockProperties({ collisionShape }))

const propertiesAt = (isSolid: SolidPredicate) => (bx: number, by: number, bz: number): BlockProperties | null =>
  isSolid(bx, by, bz) ? FULL_BLOCK_PROPERTIES : null

const withWorld = (isSolid: SolidPredicate, extra: ResolveOptionsInput = {}): ResolveOptions => {
  const { halfWidth = Number(HALF_W), halfHeight = Number(HALF_H), stepHeight, environment = EMPTY_ENVIRONMENT, ...options } = extra
  return {
    halfWidth: BlockLength(halfWidth),
    halfHeight: HalfHeight(halfHeight),
    environment,
    blockPropertiesAt: propertiesAt(isSolid),
    ...options,
    ...(stepHeight === undefined ? {} : { stepHeight: BlockLength(stepHeight) }),
  }
}

/** The centre Y at which a body of PLAYER_HALF_HEIGHT rests on top of `surfaceCell`. */
const restingCentre = (surfaceCell: number): CentreY =>
  unwrap(centreOfFoot(unwrap(standingPlaneAbove(BlockAxis(surfaceCell))), HALF_H))

const standingOn = (surfaceCell: number, over: BodyOverrides = {}): Body => bodyFrom({
  kind: 'dynamic',
  x: 0.5,
  y: restingCentre(surfaceCell),
  z: 0.5,
  vx: 0,
  vy: 0,
  vz: 0,
  ...over,
})

const bodyAt = (x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): Body =>
  bodyFrom({ kind: 'dynamic', x, y, z, vx, vy, vz })

const localShape = (shape: Omit<AABB, 'minX' | 'minY' | 'minZ' | 'maxX' | 'maxY' | 'maxZ'> & {
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
}): AABB => ({
  minX: unwrap(PositionAxis.result(shape.minX)),
  minY: unwrap(PositionAxis.result(shape.minY)),
  minZ: unwrap(PositionAxis.result(shape.minZ)),
  maxX: unwrap(PositionAxis.result(shape.maxX)),
  maxY: unwrap(PositionAxis.result(shape.maxY)),
  maxZ: unwrap(PositionAxis.result(shape.maxZ)),
})

const boxOf = (body: BodyInput, halfHeight = HALF_H, halfWidth = HALF_W) =>
  unwrap(entityAABB(bodyFrom(body).x, bodyFrom(body).y, bodyFrom(body).z, halfWidth, halfHeight))

/** Does the body overlap any block by more than the contact skin? */
const penetratesSomething = (body: BodyInput, isSolid: SolidPredicate): boolean => {
  const box = boxOf(body)
  // This property supplies full block cubes, so only cells spanned by the AABB can overlap it.
  for (let bx = Math.floor(box.minX); bx <= Math.floor(box.maxX); bx += 1) {
    for (let by = Math.floor(box.minY); by <= Math.floor(box.maxY); by += 1) {
      for (let bz = Math.floor(box.minZ); bz <= Math.floor(box.maxZ); bz += 1) {
        if (isSolid(bx, by, bz)) {
          const block: AABB = {
            minX: PositionAxis(bx),
            minY: PositionAxis(by),
            minZ: PositionAxis(bz),
            maxX: PositionAxis(bx + 1),
            maxY: PositionAxis(by + 1),
            maxZ: PositionAxis(bz + 1),
          }
          if (collidesWith(box, block)) {
            return true
          }
        }
      }
    }
  }
  return false
}

/** Kinetic plus gravitational potential energy, per unit mass. */
const energyOf = (body: BodyInput): number =>
  0.5 * (body.vx * body.vx + body.vy * body.vy + body.vz * body.vz) + Math.abs(GRAVITY_Y) * body.y

describe('sneak edge prevention', () => {
  const insideSupport = 0.75
  const outsideSupport = 1.25
  const supportLimit = 1
  const supported = (positionX: number, positionZ: number): boolean =>
    positionX <= supportLimit && positionZ <= supportLimit

  it('keeps movement on supported ground unchanged', () => {
      expect(
        clampSneakEdge(
          { x: insideSupport, z: insideSupport },
          { x: insideSupport, z: supportLimit },
          supported,
        ),
      ).toStrictEqual({
        x: insideSupport,
        z: supportLimit,
      })
  })

  it('clamps only the axis that would cross an unsupported edge', () => {
      expect(
        clampSneakEdge(
          { x: insideSupport, z: insideSupport },
          { x: outsideSupport, z: supportLimit },
          supported,
        ),
      ).toStrictEqual({
        x: insideSupport,
        z: supportLimit,
      })
  })

  it('clamps both axes when each independent move loses support', () => {
      expect(
        clampSneakEdge(
          { x: insideSupport, z: insideSupport },
          { x: outsideSupport, z: outsideSupport },
          supported,
        ),
      ).toStrictEqual({
        x: insideSupport,
        z: insideSupport,
      })
  })

  it('does not query support for an axis that did not move', () => {
      const queries: Array<readonly [number, number]> = []
      const result = clampSneakEdge(
        { x: insideSupport, z: insideSupport },
        { x: insideSupport, z: supportLimit },
        (positionX, positionZ) => {
          queries.push([positionX, positionZ])
          return true
        },
      )

      expect(result).toStrictEqual({ x: insideSupport, z: supportLimit })
      expect(queries).toStrictEqual([[insideSupport, supportLimit]])
  })
})

describe('standard non-cubic block shapes', () => {
  it('treats the kernel none shape as empty space', () => {
      const options = withWorld(() => false, {
        blockPropertiesAt: (bx, by, bz) => (bx === 0 && by === 0 && bz === 0 ? propertiesFor('none') : null),
      })
      const falling: BodyInput = { ...standingOn(0), y: CentreY(Number(HALF_H) + 1 / 16 + 0.01), vy: -1 }

      const stepped = stepBody(falling, DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.isGrounded).toBe(false)
      expect(stepped.body.y).toBeLessThan(falling.y)
  })

  it('lands on the pressure plate top face rather than the cell top', () => {
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 0 && by === 0 && bz === 0 ? PRESSURE_PLATE_SHAPE : null),
      })
      const falling: BodyInput = { ...standingOn(0), y: CentreY(Number(HALF_H) + 1 / 16 + 0.01), vy: -1 }

      const stepped = stepBody(falling, DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.y).toBe(Number(HALF_H) + 1 / 16)
      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(true)
  })

  it('allows movement before the cactus inset and clamps exactly at it', () => {
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 1 && by === 1 && bz === 0 ? CACTUS_SHAPE : null),
      })
      const before: BodyInput = { ...standingOn(0), x: 0.69, y: CentreY(1.5), vx: 1 }
      const crossing: BodyInput = { ...before, x: 0.75 }

      const unobstructed = stepBody(before, DT, options, { gravityY: BlocksPerSecondSquared(0) })
      const blocked = stepBody(crossing, DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(unobstructed.body.x).toBe(0.69 + DT)
      expect(unobstructed.body.vx).toBe(1)
      expect(blocked.body.x).toBe(1 + 1 / 16 - HALF_W)
      expect(blocked.body.vx).toBe(0)
  })

  it('resolves the same shaped-block input deterministically', () => {
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 1 && by === 1 && bz === 0 ? CACTUS_SHAPE : null),
      })
      const body: BodyInput = { ...standingOn(0), x: 0.75, y: CentreY(1.5), vx: 1 }

      expect(stepBody(body, DT, options, { gravityY: BlocksPerSecondSquared(0) })).toStrictEqual(stepBody(body, DT, options, { gravityY: BlocksPerSecondSquared(0) }))
  })

  it('resolves the nearest component of a compound block shape', () => {
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 1 && by === 1 && bz === 0
          ? [
              localShape({ minX: 0.75, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }),
              localShape({ minX: 0, minY: 0, minZ: 0, maxX: 0.25, maxY: 1, maxZ: 1 }),
            ]
          : null),
      })
      const body: BodyInput = { ...standingOn(0), x: 0.5, y: CentreY(1.5), vx: 100 }

      const result = stepBody(body, DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(result.body.x).toBe(1 - HALF_W)
      expect(result.body.vx).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// AXIS ORDER — physics-resolve-y-before-x
// ---------------------------------------------------------------------------

describe('the axis order is Y, then X, then Z', () => {
  it('a body walking along flat ground crosses the seam between two floor blocks', () => {
      // THE test for the ordering, because it is the one whose failure is a
      // symptom rather than a crash: with X resolved first the player catches
      // on every block boundary and no single frame looks wrong.
      //
      // The mechanism: the integrator has just sunk the body ~3.9 mm into the
      // floor (one frame's fall). Resolve X first and the floor block AHEAD
      // overlaps the body by those 3.9 mm on all three axes, so it reads as a
      // wall and the body is clamped to x = 1 - halfWidth = 0.7 — for ever.
      // Resolve Y first and the body is lifted clear before X looks.
      const options = withWorld((_bx, by) => by === 0)
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      expect(stepped.body.x).toBe(0.85 + REFERENCE_TOP_SPEED * DT)
      expect(stepped.body.x).toBeGreaterThan(1 - HALF_W)
      expect(stepped.body.vx).toBe(REFERENCE_TOP_SPEED)
      expect(stepped.body.y).toBe(restingCentre(0))
      expect(stepped.isGrounded).toBe(true)
  })

  it('and keeps crossing them: a hundred frames of walking travel the whole distance', () => {
      // One frame proves the mechanism; a hundred proves nothing accumulates.
      // Under X-first this stops dead at 0.7 and never moves again.
      const options = withWorld((_bx, by) => by === 0)
      let body = standingOn(0, { x: 0.5, vx: REFERENCE_TOP_SPEED })

      for (let frame = 0; frame < 100; frame += 1) {
        const stepped = stepBody(body, DT, options)
        expect(stepped.isGrounded).toBe(true)
        expect(stepped.body.y).toBe(restingCentre(0))
        body = stepped.body
      }

      expect(body.x).toBeCloseTo(0.5 + 100 * REFERENCE_TOP_SPEED * DT, 9)
      expect(body.x).toBeGreaterThan(13)
  })

  it('Y before X: a body falling onto a ledge does not embed sideways', () => {
      // Carried across from the reference, which keeps the same invariant with
      // the same scenario (`packages/game/test/aabb-collision-edge-cases.test.ts:220`,
      // 'Y axis is resolved before X — player falling onto a ledge does not
      // embed sideways'). Falling with a small sideways velocity: Y clamps
      // first, after which X finds nothing in the way.
      //
      // MEASURED: this one does NOT discriminate the ordering here — it stays
      // green with the horizontal phases moved in front of Y, because the
      // face-span guard in clampAxis declines the ledge's near face anyway. It
      // is kept because the behaviour is worth pinning, not because it is
      // evidence for the order; the seam and step-up tests above are that.
      const options = withWorld((_bx, by) => by === 9)
      const falling = standingOn(9, { vx: 0.5, vy: -3 })

      const stepped = stepBody(falling, DT, options)

      expect(stepped.isGrounded).toBe(true)
      expect(stepped.body.vy).toBe(0)
      expect(stepped.body.y).toBe(restingCentre(9))
      // X was never blocked: the body moved exactly as far as its velocity said.
      expect(stepped.body.vx).toBe(0.5)
      expect(stepped.body.x).toBe(0.5 + 0.5 * DT)
  })

  it('Y before X is what makes step-up work without a second horizontal pass', () => {
      // A slab in the column ahead. The Y phase lifts the body onto it, so by
      // the time X runs there is nothing to collide with. Resolve X first and
      // the slab is a wall, which is the case the reference recovers with a
      // whole second horizontal pass (`aabb-collision.ts:303-318`).
      const isSlab = (bx: number, by: number): boolean => bx === 1 && by === 1
      const options = withWorld((bx, by) => by === 0 || isSlab(bx, by), {
        blockPropertiesAt: (bx, by, _bz) => {
          if (isSlab(bx, by)) {
            return propertiesFor('slab')
          }
          if (by === 0) {
            return FULL_BLOCK_PROPERTIES
          }
          return null
        },
        stepHeight: 0.6,
      })
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      // Lifted onto the slab's top face at y = 1.5, not stopped in front of it.
      expect(stepped.body.y).toBe(1.5 + Number(HALF_H))
      expect(stepped.body.x).toBe(0.85 + REFERENCE_TOP_SPEED * DT)
      expect(stepped.body.vx).toBe(REFERENCE_TOP_SPEED)
      expect(stepped.isGrounded).toBe(true)
  })

  it('with no step height injected, the same slab is a wall', () => {
      // The mechanism is here, the value is mc-sim's (docs/responsibility.md
      // §3). Default zero means the resolver on its own never lifts a body onto
      // anything it did not fall onto.
      const isSlab = (bx: number, by: number): boolean => bx === 1 && by === 1
      const options = withWorld((bx, by) => by === 0 || isSlab(bx, by), {
        blockPropertiesAt: (bx, by, _bz) => {
          if (isSlab(bx, by)) {
            return propertiesFor('slab')
          }
          if (by === 0) {
            return FULL_BLOCK_PROPERTIES
          }
          return null
        },
      })
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      expect(stepped.body.x).toBe(1 - HALF_W)
      expect(stepped.body.vx).toBe(0)
      expect(stepped.body.y).toBe(restingCentre(0))
  })

  it('rejects a step when the raised retry still collides on X', () => {
      const isSlab = (bx: number, by: number): boolean => bx === 1 && by === 1
      const isOverhead = (bx: number, by: number): boolean => bx === 1 && by === 2
      const options = withWorld((bx, by) => by === 0 || isSlab(bx, by) || isOverhead(bx, by), {
        blockPropertiesAt: (bx, by, _bz) => {
          if (isSlab(bx, by)) {
            return propertiesFor('slab')
          }
          if (by === 0 || isOverhead(bx, by)) {
            return FULL_BLOCK_PROPERTIES
          }
          return null
        },
        stepHeight: 0.6,
      })
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const result = stepBody(walking, DT, options)

      expect(result.body.x).toBe(1 - HALF_W)
      expect(result.body.vx).toBe(0)
      expect(result.body.y).toBe(restingCentre(0))
  })

  it('rejects a step when the raised retry still collides on Z', () => {
      const isSlab = (bz: number, by: number): boolean => bz === 1 && by === 1
      const isOverhead = (bz: number, by: number): boolean => bz === 1 && by === 2
      const options = withWorld((_bx, by, bz) => by === 0 || isSlab(bz, by) || isOverhead(bz, by), {
        blockPropertiesAt: (_bx, by, bz) => {
          if (isSlab(bz, by)) {
            return propertiesFor('slab')
          }
          if (by === 0 || isOverhead(bz, by)) {
            return FULL_BLOCK_PROPERTIES
          }
          return null
        },
        stepHeight: 0.6,
      })
      const walking = standingOn(0, { z: 0.85, vz: REFERENCE_TOP_SPEED })

      const result = stepBody(walking, DT, options)

      expect(result.body.z).toBe(1 - HALF_W)
      expect(result.body.vz).toBe(0)
      expect(result.body.y).toBe(restingCentre(0))
  })

  it('does not treat a shape above step reach as support', () => {
      const body = standingOn(0)
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) =>
          bx === 0 && by === 1 && bz === 0
            ? localShape({ minX: 0, maxX: 1, minY: 0.25, maxY: 1, minZ: 0, maxZ: 1 })
            : null,
        stepHeight: 0.6,
      })

      const result = tryStepUp(
        body,
        body.y,
        { blocked: true, position: body.x, velocity: 0 },
        { blocked: false, position: body.z, velocity: 0 },
        0,
        options,
      )

      expect(result).toBeNull()
  })

  it('uses zero step height when none is configured', () => {
      const body = standingOn(0)
      const result = tryStepUp(
        body,
        body.y,
        { blocked: true, position: body.x, velocity: 0 },
        { blocked: false, position: body.z, velocity: 0 },
        0,
        withWorld(() => false),
      )

      expect(result).toBeNull()
  })

  it('keeps the highest support when later shapes are lower', () => {
      const body = standingOn(0)
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) =>
          bx === 0 && by === 1 && bz === 0
            ? [
              localShape({ minX: 0, maxX: 1, minY: 0, maxY: 0.5, minZ: 0, maxZ: 1 }),
              localShape({ minX: 0, maxX: 1, minY: 0, maxY: 0.25, minZ: 0, maxZ: 1 }),
            ]
            : null,
        stepHeight: 0.6,
      })

      const result = tryStepUp(
        body,
        body.y,
        { blocked: true, position: body.x, velocity: 0 },
        { blocked: false, position: body.z, velocity: 0 },
        0,
        options,
      )

      expect(result?.y).toBe(1.5 + Number(HALF_H))
  })

  it('does not treat an epsilon-only horizontal contact as support', () => {
      const body = standingOn(0)
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) =>
          bx === 0 && by === 1 && bz === 0
            ? localShape({ minX: 0, maxX: body.x - HALF_W + CONTACT_EPSILON / 2, minY: 0, maxY: 0.5, minZ: 0, maxZ: 1 })
            : null,
        stepHeight: 0.6,
      })

      const result = tryStepUp(
        body,
        body.y,
        { blocked: true, position: body.x, velocity: 0 },
        { blocked: false, position: body.z, velocity: 0 },
        0,
        options,
      )

      expect(result).toBeNull()
  })

  it('rejects a backward step when the raised retry still collides on X', () => {
      const body = standingOn(0, { vx: -1 })
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) =>
          bx === 0 && by === 2 && bz === 0
            ? localShape({ minX: 0, maxX: 0.5, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
            : null,
        stepHeight: 0.6,
      })

      const result = tryStepUp(
        body,
        body.y,
        { blocked: true, position: body.x, velocity: -1 },
        { blocked: false, position: body.z, velocity: 0 },
        0,
        options,
      )

      expect(result).toBeNull()
  })

  it('rejects a backward step when the raised retry still collides on Z', () => {
      const body = standingOn(0, { vz: -1 })
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) =>
          bx === 0 && by === 2 && bz === 0
            ? localShape({ minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 0.5 })
            : null,
        stepHeight: 0.6,
      })

      const result = tryStepUp(
        body,
        body.y,
        { blocked: false, position: body.x, velocity: 0 },
        { blocked: true, position: body.z, velocity: -1 },
        0,
        options,
      )

      expect(result).toBeNull()
  })

  it('Z is resolved against the X the previous phase corrected, so a body slides along a wall', () => {
      // A wall along +X with a block behind its corner. Walking diagonally into
      // it, X stops the body at the wall face — and that correction takes the
      // body OUT of the column the second block sits in, so Z is free and the
      // body slides along the wall instead of sticking to it.
      //
      // Resolve Z against the pre-X position and the second block is still in
      // range, so Z is clamped too and the body stops dead in the middle of a
      // flat wall. That is the "sticky wall" symptom, and it is the only thing
      // separating the two orders here: with the corrected X the block is
      // exactly touching, and touching is not colliding.
      const options = withWorld((bx, by, bz) => by === 0 || (by === 1 && bx === 1 && (bz === 0 || bz === 1)))
      const diagonal = standingOn(0, { x: 0.85, z: 0.85, vx: 4, vz: 4 })

      const stepped = stepBody(diagonal, DT, options)

      expect(stepped.body.x).toBe(1 - HALF_W)
      expect(stepped.body.vx).toBe(0)
      // Z untouched: the body keeps sliding.
      expect(stepped.body.z).toBe(0.85 + 4 * DT)
      expect(stepped.body.vz).toBe(4)
      expect(stepped.isGrounded).toBe(true)
  })

  it('walking into an inside corner stops on both axes without either phase teleporting the body', () => {
      // The block diagonally across the corner overlaps the body on both
      // horizontal axes — deeply on X, shallowly on Z. Resolving X against its
      // far-side face would move the body a whole block backwards; the face
      // must be one the body actually came in through.
      const options = withWorld((bx, by, bz) => by === 0 || (by === 1 && (bx === 1 || bz === 1)))
      const diagonal = standingOn(0, { x: 0.85, z: 0.85, vx: 4, vz: 4 })

      const stepped = stepBody(diagonal, DT, options)

      expect(stepped.body.x).toBe(1 - HALF_W)
      expect(stepped.body.z).toBe(1 - HALF_W)
      expect(stepped.body.vx).toBe(0)
      expect(stepped.body.vz).toBe(0)
      expect(stepped.isGrounded).toBe(true)
  })
})

describe('continuous collision for high-speed steps', () => {
  const FAST_DT = DeltaTimeSecs(0.25)

  it('stops at the first wall crossed, even after crossing several empty voxels', () => {
      const options = withWorld((bx, by, bz) => by === 0 || (bx === 2 && by === 1 && bz === 0))
      const fast = standingOn(0, { vx: 100 })

      const stepped = stepBody(fast, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.x).toBeCloseTo(2 - HALF_W, 12)
      expect(stepped.body.vx).toBe(0)
      expect(stepped.body.y).toBe(fast.y)
  })

  it('does not tunnel through a thin collision shape', () => {
      const thin = localShape({ minX: 0.45, maxX: 0.55, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 2 && by === 1 && bz === 0 ? thin : null),
      })
      const fast = standingOn(0, { vx: 100 })

      const stepped = stepBody(fast, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.x).toBeCloseTo(2.45 - HALF_W, 12)
      expect(stepped.body.vx).toBe(0)
  })

  it('catches a ceiling crossed by a high-speed vertical launch', () => {
      const options = withWorld((bx, by, bz) => bx === 0 && by === 4 && bz === 0)
      const rising: BodyInput = { ...standingOn(0), y: CentreY(1.5), vy: 100 }

      const stepped = stepBody(rising, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.y).toBeCloseTo(4 - Number(HALF_H), 12)
      expect(stepped.body.vy).toBe(0)
  })

  it('resolves a diagonal corner deterministically on both horizontal axes', () => {
      const options = withWorld((bx, by, bz) => bx === 2 && by === 1 && bz === 2)
      const diagonal = standingOn(0, { vx: 100, vz: 100 })

      const first = stepBody(diagonal, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })
      const second = stepBody(diagonal, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(first).toStrictEqual(second)
      expect(first.body.x).toBeCloseTo(2 - HALF_W, 12)
      expect(first.body.z).toBeCloseTo(2 - HALF_W, 12)
      expect(first.body.vx).toBe(0)
      expect(first.body.vz).toBe(0)
  })

  it('selects the earliest hit rather than the first candidate returned by the world', () => {
      const options = withWorld((bx, by, bz) =>
        (bx === 1 && by === 5 && bz === 0) || (bx === 2 && by === 3 && bz === 0),
      )
      const diagonal: BodyInput = { ...standingOn(0), y: CentreY(1.5), vx: 50, vy: 100 }

      const stepped = stepBody(diagonal, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.x).toBeCloseTo(2 - HALF_W, 12)
      expect(stepped.body.vx).toBe(0)
  })

  it('uses Y before X when two swept faces are reached simultaneously', () => {
      const options = withWorld((bx, by, bz) =>
        (bx === 1 && by === 4 && bz === 0) || (bx === 2 && by === 2 && bz === 0),
      )
      const diagonal: BodyInput = { ...standingOn(0), y: CentreY(1.5), vx: 75, vy: 100 }

      const stepped = stepBody(diagonal, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.y).toBeCloseTo(4 - Number(HALF_H), 12)
      expect(stepped.body.vy).toBe(0)
  })

  it('uses X before Z when two swept faces are reached simultaneously', () => {
      const options = withWorld((bx, by, bz) =>
        (bx === 1 && by === 1 && bz === 4) || (bx === 2 && by === 1 && bz === 3),
      )
      const diagonal = standingOn(0, { vx: 75, vz: 200 })

      const stepped = stepBody(diagonal, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.x).toBeCloseTo(2 - HALF_W, 12)
      expect(stepped.body.vx).toBe(0)
  })

  it('blocks motion into an initial contact but permits motion away from it', () => {
      const options = withWorld((bx, by, bz) => bx === 1 && by === 1 && bz === 0)
      const touching = standingOn(0, { x: 1 - HALF_W })

      const inward = stepBody({ ...touching, vx: 100 }, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })
      const outward = stepBody({ ...touching, vx: -100 }, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(inward.body.x).toBe(touching.x)
      expect(inward.body.vx).toBe(0)
      expect(outward.body.x).toBeCloseTo(touching.x - 25, 12)
      expect(outward.body.vx).toBe(-100)
  })

  it('does not turn a pre-existing overlap into a trap', () => {
      const options = withWorld((bx, by, bz) => bx === 1 && by === 1 && bz === 0)
      const overlapping = standingOn(0, { x: 1.5, vx: -100 })

      const escaped = stepBody(overlapping, FAST_DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(escaped.body.x).toBeCloseTo(-23.5, 12)
      expect(escaped.body.vx).toBe(-100)
  })
})

// ---------------------------------------------------------------------------
// THE GROUND CLAMP AND ITS ORDER — physics-resolve-runs-after-integrate (P-3)
// ---------------------------------------------------------------------------

describe('the ground clamp lives inside the resolver and runs after integrate', () => {
  it('a body falling onto a floor is clamped to it, with its downward velocity zeroed', () => {
      // `y = maxFloorY + halfH; vy = 0` — the reference's three lines
      // (aabb-collision.ts:281-285), which are the only ground clamp in its
      // codebase. There is no separate snap pass here either.
      const options = withWorld(groundUpTo(63))
      // Half a frame's worth of fall above the floor, moving down at 5 m/s: one
      // step overshoots and the clamp takes it back to the surface exactly.
      const falling = standingOn(63, { y: CentreY(restingCentre(63) + 0.05), vy: -5 })

      const stepped = stepBody(falling, DT, options)

      expect(stepped.body.y).toBe(restingCentre(63))
      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(true)
  })

  it('REGRESSION: reversing the order leaves the body sunk one frame’s fall INTO the floor', () => {
      // docs/design-notes.md P-3 asks for this test and predicts the body
      // "hovers one frame's fall above the floor". MEASURED, THE SIGN IS THE
      // OTHER WAY: integrate-after-resolve leaves the body one frame's fall
      // BELOW the floor, permanently, because the last thing that happens each
      // frame is the fall and nothing corrects it until the next frame has
      // already been observed. The invariant P-3 defends is untouched — the
      // order is load-bearing and this is what breaking it costs — but the
      // symptom it names is wrong, and the note now says so.
      const options = withWorld(groundUpTo(63))
      const oneFramesFall = Math.abs(GRAVITY_Y) * DT * DT

      let right = standingOn(63)
      let wrong = standingOn(63)
      for (let frame = 0; frame < 50; frame += 1) {
        right = stepBody(right, DT, options).body
        wrong = integrateBody(resolveBody(wrong, DT, options).body, DT)
      }

      expect(right.y).toBe(restingCentre(63))
      expect(wrong.y).toBeLessThan(right.y)
      expect(right.y - wrong.y).toBeCloseTo(oneFramesFall, 12)
      // Permanent: it is a fixed point, not a transient that settles.
      expect(integrateBody(resolveBody(wrong, DT, options).body, DT).y).toBe(wrong.y)
  })

  it('a body pushed up into a ceiling stops there and is not grounded', () => {
      const options = withWorld((_bx, by) => by === 0 || by === 3)
      // Head 1 cm under the ceiling's underside at y = 3, moving up at 8 m/s:
      // one step would put the head 0.146 through it.
      const jumping = standingOn(0, { y: CentreY(3 - Number(HALF_H) - 0.01), vy: 8 })

      const stepped = stepBody(jumping, DT, options)

      expect(stepped.body.y).toBe(3 - Number(HALF_H))
      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(false)
  })

  it('a wall is not a floor: walking into a full block does not climb it', () => {
      // Without a reach test on the Y phase every wall is climbable — the body
      // overlaps the wall block, the wall's top face is the highest one around,
      // and the body is teleported on top of it. The reference explains this at
      // aabb-collision.ts:20-25 and needs MAX_STEP_UP for it; here the reach is
      // the step's own fall, so no constant is involved.
      const options = withWorld((bx, by) => by === 0 || (bx === 1 && by === 1))
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      expect(stepped.body.y).toBe(restingCentre(0))
      expect(stepped.body.x).toBe(1 - HALF_W)
      expect(stepped.body.vx).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// RESTING CONTACT — physics-resting-contact-is-not-a-collision (P-6)
// ---------------------------------------------------------------------------

describe('resting contact', () => {
  it('a body lands in exactly the state test/coordinates.test.ts documents', () => {
      // The counterexample the coordinate property test found: surfaceY = 1,
      // halfHeight = 0.05. `intersects` IS true, `isRestingOn` is true, and the
      // penetration is a positive number smaller than 1e-15. The resolver has
      // to land the body in that state and leave it there — the epsilon is in
      // the PREDICATE, and `floorTop + halfHeight` is written out exactly, with
      // nothing added to lift the body clear.
      const halfHeight = HalfHeight(0.05)
      const standingFoot = unwrap(standingPlaneAbove(BlockAxis(1)))
      const standingCentre = unwrap(centreOfFoot(standingFoot, halfHeight))
      const options = withWorld(groundUpTo(1), { halfHeight })
      const falling: BodyInput = {
        kind: 'dynamic',
        x: 0.5,
        y: standingCentre,
        z: 0.5,
        vx: 0,
        vy: 0,
        vz: 0,
      }

      const landed = stepBody(falling, DT, options).body
      const box = unwrap(entityAABB(landed.x, landed.y, landed.z, HALF_W, halfHeight))
      const block = unwrap(blockAABB(BlockAxis(0), BlockAxis(1), BlockAxis(0)))

      expect(landed.y).toBe(standingCentre)
      expect(intersects(box, block)).toBe(true)
      expect(isRestingOn(box, block)).toBe(true)
      const penetration = unwrap(penetrationY(box, block))
      expect(penetration).toBeGreaterThan(0)
      expect(penetration).toBeLessThan(1e-15)
  })

  it('a resting body does not drift by one ulp per frame, for a thousand frames', () => {
      // The failure this rules out is the one design-notes P-6 describes: a
      // resolver that treats the ~2e-16 resting overlap as a collision pushes
      // the body up by that much every frame. Exact equality, not toBeCloseTo:
      // a drift of one ulp per frame is invisible to any tolerance and visible
      // in a save file after an hour.
      const options = withWorld(groundUpTo(63))
      let body = standingOn(63)

      for (let frame = 0; frame < 1000; frame += 1) {
        const stepped = stepBody(body, DT, options)
        expect(stepped.body.y).toBe(restingCentre(63))
        expect(stepped.body.vy).toBe(0)
        expect(stepped.isGrounded).toBe(true)
        body = stepped.body
      }
  })

  it('resolving is a fixed point: a resolved body resolves to itself, bit for bit', () => {
      // Idempotence is what says the resolver has no opinion left to act on.
      // Compare values structurally: object key insertion order is not state.
      // `isGrounded` is part of it, and it is the part that costs something:
      // taking it from the Y phase, as the reference does (`isGrounded = true`
      // beside the ground clamp), makes the first answer true and the second
      // false for the same body in the same place. The generator has to land
      // bodies for that to show, which is why it integrates first — a body
      // resolved from the air has nothing to clamp and would agree either way.
      fc.assert(
        fc.property(
          fc.double({ min: -0.05, max: 2, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -12, max: 4, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -8, max: 8, noNaN: true, noDefaultInfinity: true }),
          (height, vy, vx) => {
            const options = withWorld(groundUpTo(63))
            const start = standingOn(63, { y: CentreY(restingCentre(63) + height), vy, vx })
            const once = resolveBody(integrateBody(start, DT), DT, options)
            const twice = resolveBody(once.body, DT, options)
            return isDeepStrictEqual(once, twice)
          },
        ),
        { numRuns: 300 },
      )
  })

  it('PROPERTY: no phase moves a body further than that phase can justify', () => {
      // The bound that keeps a correction from becoming a teleport, and the
      // only thing standing between the two horizontal phases and the inside
      // corner: a face already BEHIND the body is not one it came in through,
      // and resolving against it would move the body further than its own
      // width. Vertically the bound is the distance actually travelled plus
      // whatever step height was injected — which is the same statement as "a
      // wall is not a floor", made quantitative.
      fc.assert(
        fc.property(
          fc.double({ min: 63.5, max: 68, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -0.5, max: 2.5, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -12, max: 12, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -12, max: 12, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -12, max: 12, noNaN: true, noDefaultInfinity: true }),
          (y, x, vx, vy, vz) => {
            // Terrain with an inside corner and an overhang to aim at.
            const options = withWorld(
              (bx, by, bz) => by <= 63 || (by <= 66 && (bx === 1 || bz === 1)) || (by === 67 && bx === 0),
            )
            const body: BodyInput = { kind: 'dynamic', x, y: CentreY(y), z: 0.5, vx, vy, vz }
            const resolved = resolveBody(body, DT, options).body

            const horizontalBound = 2 * HALF_W + CONTACT_EPSILON
            const verticalBound = Math.abs(vy) * DT + CONTACT_EPSILON
            return (
              Math.abs(resolved.x - body.x) <= horizontalBound &&
              Math.abs(resolved.z - body.z) <= horizontalBound &&
              Math.abs(resolved.y - body.y) <= verticalBound
            )
          },
        ),
        { numRuns: 500 },
      )
  })
})

// ---------------------------------------------------------------------------
// ZERO PENETRATION — plan.md §3.4
// ---------------------------------------------------------------------------

describe('zero penetration', () => {
  const heightAt = (heights: ReadonlyArray<number>, index: number): number => {
    const height = heights[index]
    if (height === undefined) {
      throw new Error(`heightmap has no column ${index}`)
    }
    return height
  }

  /**
   * A periodic heightmap: column (bx, bz) is solid up to `heights[...]`. Infinite
   * in both directions so a body can never walk off the edge of the data, and
   * always solid far below so it can never fall out of the world.
   */
  const heightmapWorld =
    (heights: ReadonlyArray<number>): SolidPredicate =>
    (bx, by, bz) => {
      const index = (((bx * 7 + bz * 13) % heights.length) + heights.length) % heights.length
      return by <= heightAt(heights, index)
    }

  it('PROPERTY: a body walking over broken terrain never ends a step inside a block', () => {
      // The invariant is INDUCTIVE — the resolver maintains "not penetrating",
      // it does not establish it (see domain/resolve.ts on the precondition) —
      // so the body starts in the air and every step is checked, not just the
      // last one.
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 60, max: 64 }), { minLength: 3, maxLength: 8 }),
          fc.double({ min: -6, max: 6, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -6, max: 6, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          (heights, vx, vz, rawDelta) => {
            const isSolid = heightmapWorld(heights)
            const options = withWorld(isSolid)
            const delta = DeltaTimeSecs(rawDelta)
            let body: BodyInput = { kind: 'dynamic', x: 0.5, y: CentreY(70), z: 0.5, vx, vy: 0, vz }

            for (let frame = 0; frame < 60; frame += 1) {
              body = stepBody(body, delta, options).body
              if (penetratesSomething(body, isSolid)) {
                return false
              }
            }
            return true
          },
        ),
        { numRuns: 200 },
      )
  })

  it('PROPERTY: a body dropped from any height lands on the floor and never below it', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 20, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          (dropHeight, rawDelta) => {
            const options = withWorld(groundUpTo(0))
            const delta = DeltaTimeSecs(rawDelta)
            const floorCentre = restingCentre(0)
            let body = standingOn(0, { y: CentreY(restingCentre(0) + dropHeight) })

            // Long enough to fall 20 blocks even at the smallest legal delta.
            for (let frame = 0; frame < 2500; frame += 1) {
              const resolution = stepBody(body, delta, options)
              body = resolution.body
              if (body.y < floorCentre - CONTACT_EPSILON) {
                return false
              }
              if (resolution.isGrounded && body.y === floorCentre && body.vy === 0) {
                const confirmation = stepBody(body, delta, options)
                return confirmation.isGrounded && isDeepStrictEqual(confirmation.body, body)
              }
            }
            return false
          },
        ),
        { numRuns: 60 },
      )
  })

  it('TUNNELLING: a body arriving at terminal velocity on the largest legal step is still caught', () => {
      // The worst case the delta cap permits: |TERMINAL_VELOCITY_Y| * 0.05 =
      // 1.6 blocks in one step, against a body 1.8 tall. The floor's top face
      // ends up inside the box, which is the whole reason those two numbers are
      // tied together (design-notes P-5).
      const options = withWorld(groundUpTo(63))
      const dropped = standingOn(63, {
        y: CentreY(restingCentre(63) + maxFallPerStep(MAX_DELTA_SECS) - 0.1),
        vy: TERMINAL_VELOCITY_Y,
      })

      const stepped = stepBody(dropped, DeltaTimeSecs(MAX_DELTA_SECS), options)

      expect(stepped.body.y).toBe(restingCentre(63))
      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(true)
  })

  it('the horizontal speed that breaks discrete resolution is far above anything the game moves at', () => {
      // Discrete resolution is the choice this resolver makes (see the file
      // header). Its price is a speed limit, and this is the inequality that
      // says the game is nowhere near it. Asserted as a derivation so that
      // changing the delta cap, the body width or the movement speed fails here
      // rather than in a bug report about falling through walls.
      const limit = maxSpeedWithoutTunnelling(HALF_W, 1, MAX_DELTA_SECS)

      expect(limit).toBeCloseTo(32, 12)
      expect(REFERENCE_TOP_SPEED).toBeLessThan(limit / 4)
      // Vertically the tighter of the two bounds is the body-height one that
      // integrate.test.ts already asserts; terminal velocity is inside both.
      expect(Math.abs(TERMINAL_VELOCITY_Y)).toBeLessThan(maxSpeedWithoutTunnelling(Number(HALF_H), 1, MAX_DELTA_SECS))
  })
})

// ---------------------------------------------------------------------------
// ENERGY — plan.md §3.4
// ---------------------------------------------------------------------------

describe('energy', () => {
  it('PROPERTY: a step never increases a body’s energy', () => {
      // Kinetic plus potential, per unit mass. Every path through the resolver
      // either zeroes a velocity component or moves the body back the way it
      // came, and the Y phase can only lift a body by as far as it just fell —
      // so the resolved height is never above the height the step started at.
      // A resolver that pushed out by penetration depth plus a safety margin,
      // or that snapped to the nearest surface either way, would fail this.
      fc.assert(
        fc.property(
          fc.double({ min: 64, max: 80, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -8, max: 8, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: -8, max: 8, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          (y, vx, vy, vz, rawDelta) => {
            const options = withWorld((bx, by, bz) => by <= 63 || (by <= 70 && bx === 2 && bz === 0))
            const delta = DeltaTimeSecs(rawDelta)
            let body: BodyInput = { kind: 'dynamic', x: 0.5, y: CentreY(y), z: 0.5, vx, vy, vz }

            for (let frame = 0; frame < 40; frame += 1) {
              const before = energyOf(body)
              body = stepBody(body, delta, options).body
              if (energyOf(body) > before + 1e-9) {
                return false
              }
            }
            return true
          },
        ),
        { numRuns: 200 },
      )
  })

  it('a bouncing-height regression: a body dropped repeatedly never ends up higher than it started', () => {
      const options = withWorld(groundUpTo(63))
      const start = standingOn(63, { y: CentreY(restingCentre(63) + 10) })
      let body = start

      for (let frame = 0; frame < 500; frame += 1) {
        body = stepBody(body, DT, options).body
        expect(body.y).toBeLessThanOrEqual(start.y)
      }
      expect(body.y).toBe(restingCentre(63))
  })

  it('stepping up is the one path that adds energy — which is why the height is injected', () => {
      // Honest exception, stated rather than hidden. A step-up is a lift: the
      // body gains `g * stepHeight` of potential energy out of nothing, because
      // it is a gameplay affordance and not a collision response. It is opt-in
      // and defaults to zero for exactly this reason (docs/design-notes.md P-9).
      const isSlab = (bx: number, by: number): boolean => bx === 1 && by === 1
      const options = withWorld((bx, by) => by === 0 || isSlab(bx, by), {
        blockPropertiesAt: (bx, by, _bz) => {
          if (isSlab(bx, by)) {
            return propertiesFor('slab')
          }
          if (by === 0) {
            return FULL_BLOCK_PROPERTIES
          }
          return null
        },
        stepHeight: 0.6,
      })
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      expect(energyOf(stepped.body)).toBeGreaterThan(energyOf(walking))
      // And with no step height it does not.
      const withoutStepUp = stepBody(walking, DT, { ...options, stepHeight: BlockLength(0) })
      expect(energyOf(withoutStepUp.body)).toBeLessThanOrEqual(energyOf(walking))
  })
})

// ---------------------------------------------------------------------------
// DETERMINISM AND ORDER-INDEPENDENCE — plan.md §3.4
// ---------------------------------------------------------------------------

describe('determinism', () => {
  const world = withWorld(groundUpTo(63))
  const crowd: ReadonlyArray<Body> = [
    standingOn(63, { x: 0.5, vx: 3 }),
    standingOn(63, { x: 4.5, y: CentreY(restingCentre(63) + 6), vy: -12 }),
    standingOn(63, { kind: 'static', x: 8.5 }),
    standingOn(63, { kind: 'kinematic', x: 12.5, vy: 4 }),
    standingOn(63, { x: 16.5, vz: -5 }),
  ]
  const crowdAt = (index: number): Body => {
    const body = crowd[index]
    if (body === undefined) {
      throw new Error(`crowd has no body at ${index}`)
    }
    return body
  }

  it('resolving the same world twice gives the same answer', () => {
      expect(resolveWorld(crowd, DT, world)).toStrictEqual(resolveWorld(crowd, DT, world))
      expect(stepWorld(crowd, DT, world)).toStrictEqual(stepWorld(crowd, DT, world))
  })

  it('is order-independent: bodies collide with blocks, never with each other', () => {
      // The same claim test/integrate.test.ts makes about integration, extended
      // to resolution. It holds for a structural reason rather than a numerical
      // one — `resolveWorld` is a map — and the test is here so that adding
      // entity-entity collision has to break something visible.
      const reversed = resolveWorld([...crowd].reverse(), DT, world)
      expect([...reversed].reverse()).toStrictEqual(resolveWorld(crowd, DT, world))

      const steppedReversed = stepWorld([...crowd].reverse(), DT, world)
      expect([...steppedReversed].reverse()).toStrictEqual(stepWorld(crowd, DT, world))
  })

  it('PROPERTY: the answer does not depend on where a body sits in the array', () => {
      fc.assert(
        fc.property(fc.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5 }), (order) => {
          const permuted = order.map((index) => crowdAt(index))
          const resolvedTogether = resolveWorld(permuted, DT, world)
          // `stepWorld` is checked here rather than only above because the
          // reversal test cannot see it. That test probes with `reverse()` and
          // compares a reversed answer, so a `reverse()` INSIDE the map cancels
          // out and it stays green — the one permutation it is blind to is the
          // one it uses. This asks the positional question directly: entry
          // `position` is the answer for the body at that position and for no
          // other, which is what "is a map" means and what a caller pairing
          // resolutions back to its own body list depends on.
          const steppedTogether = stepWorld(permuted, DT, world)
          return order.every((index, position) => {
            const alone = resolveWorld([crowdAt(index)], DT, world).at(0)
            const steppedAlone = stepWorld([crowdAt(index)], DT, world).at(0)
            if (alone === undefined || steppedAlone === undefined) {
              throw new Error('resolving a one-body list must return exactly one resolution')
            }
            return (
              JSON.stringify(resolvedTogether[position]) === JSON.stringify(alone) &&
              JSON.stringify(steppedTogether[position]) === JSON.stringify(steppedAlone)
            )
          })
        }),
        { numRuns: 100 },
      )
  })

  it('never moves a static or kinematic body, but still answers whether it is grounded', () => {
      // `integrateBody` leaves them alone for the same reason: their motion is
      // authored elsewhere. Grounded is a question about the world, though, so
      // it is answered for them too.
      const options = withWorld(groundUpTo(63))
      for (const kind of ['static', 'kinematic'] as const) {
        const resting = standingOn(63, { kind, vy: -20 })
        const airborne = standingOn(63, { kind, y: CentreY(restingCentre(63) + 20) })

        expect(resolveBody(resting, DT, options).body).toStrictEqual(resting)
        expect(resolveBody(resting, DT, options).isGrounded).toBe(true)
        expect(resolveBody(airborne, DT, options).isGrounded).toBe(false)
      }
  })
})

// ---------------------------------------------------------------------------
// THE WORLD IS A CALLBACK — physics-no-block-id-name-checks (P-8)
// ---------------------------------------------------------------------------

describe('solidity is injected, never derived from a block id', () => {
  it('only asks about cells the body could touch', () => {
      // design-notes P-8 asks for exactly this: that the coordinates handed to
      // the callback stay inside the box being asked about. A resolver that
      // scanned a chunk, or that probed a fixed radius, would be reaching for
      // world knowledge it is not allowed to have — and would cost the caller a
      // chunk lookup per frame per body.
      //
      // One cell BELOW the body is expected and is not slack: it is the support
      // probe, which has to look at the block the feet are standing on top of.
      const asked: Array<readonly [number, number, number]> = []
      const options = withWorld((bx, by, bz) => {
        asked.push([bx, by, bz])
        return by <= 63
      })
      const body = standingOn(63, { x: 0.5, z: 0.5, vx: 2, vz: -2 })

      stepBody(body, DT, options)

      expect(asked.length).toBeGreaterThan(0)
      for (const [bx, by, bz] of asked) {
        expect(bx).toBeGreaterThanOrEqual(-1)
        expect(bx).toBeLessThanOrEqual(1)
        expect(bz).toBeGreaterThanOrEqual(-1)
        expect(bz).toBeLessThanOrEqual(1)
        expect(by).toBeGreaterThanOrEqual(62)
        expect(by).toBeLessThanOrEqual(66)
      }
  })

  it('kernel block properties select slab geometry without changing neighboring full blocks', () => {
      // The resolver reads the kernel's collision shape directly. A caller
      // only supplies a state-specific blockShapeAt when the kernel property
      // is not enough to describe the actual geometry.
      const options = withWorld(groundUpTo(63), {
        blockPropertiesAt: (bx, by, _bz) => {
          if (by === 63 && bx === 0) {
            return propertiesFor('slab')
          }
          if (by <= 63) {
            return FULL_BLOCK_PROPERTIES
          }
          return null
        },
      })
      let overSlab = standingOn(63, { x: 0.5, y: restingCentre(63) })
      for (let frame = 0; frame < 40; frame += 1) {
        overSlab = stepBody(overSlab, DT, options).body
      }

      // Falls the extra half block onto the slab's top face rather than the
      // cell's, and settles there.
      expect(overSlab.y).toBe(63.5 + Number(HALF_H))
      expect(resolveBody(overSlab, DT, options).isGrounded).toBe(true)

      // The neighbouring column is a full cube, and standing on it is unchanged.
      const overCube = standingOn(63, { x: 1.5 })
      expect(stepBody(overCube, DT, options).body.y).toBe(restingCentre(63))
  })

  it('the same geometry with a different predicate gives a different answer, and no ids are involved', () => {
      // What passability means is the caller's business. mc-physics sees a
      // boolean. This is the design the reference got wrong by hand-maintaining
      // PASSABLE_BLOCK_IDS, which shipped with leaves in it and let players
      // fall through tree canopies (block-collision-predicates.ts:16-42).
      const solid = withWorld(groundUpTo(63))
      const passable = withWorld(() => false)
      const body = standingOn(63, { vy: -2 })

      expect(stepBody(body, DT, solid).isGrounded).toBe(true)
      expect(stepBody(body, DT, passable).isGrounded).toBe(false)
      expect(stepBody(body, DT, passable).body.y).toBeLessThan(restingCentre(63))
  })
})

// ---------------------------------------------------------------------------
// FR-009: BOUNCE (SLIME / BED)
// ---------------------------------------------------------------------------

describe('bounce (FR-009)', () => {
  // gravityY is pinned to 0 in the exact-value cases below so the reflected
  // velocity is a clean function of the incoming vy and bounciness alone —
  // with real gravity, integrate runs before resolve (file header on
  // integrate.ts), so the impact velocity resolveVertical actually sees
  // already includes this frame's g*dt and the expected number would have to
  // account for it too.

  it('reflects downward velocity scaled by bounciness on a genuine floor impact', () => {
      const options = withWorld(groundUpTo(63), { bouncinessAt: () => 0.5 })
      const falling = standingOn(63, { y: CentreY(restingCentre(63) + 0.05), vy: -5 })

      const stepped = stepBody(falling, DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.y).toBe(restingCentre(63))
      expect(stepped.body.vy).toBeCloseTo(2.5, 12)
      expect(stepped.isGrounded).toBe(false)
  })

  it('samples bounciness at the block cell actually contacted', () => {
      const seen: Array<readonly [number, number, number]> = []
      const options = withWorld(groundUpTo(63), {
        bouncinessAt: (bx, by, bz) => {
          seen.push([bx, by, bz])
          return 0.5
        },
      })
      const falling = standingOn(63, { y: CentreY(restingCentre(63) + 0.05), vy: -5 })

      stepBody(falling, DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(seen).toContainEqual([0, 63, 0])
  })

  it('IDENTITY: bounciness 0 is bit-identical to no bounciness option at all', () => {
      const withZero = withWorld(groundUpTo(63), { bouncinessAt: () => 0 })
      const withoutOption = withWorld(groundUpTo(63))
      const falling = standingOn(63, { y: CentreY(restingCentre(63) + 0.05), vy: -5 })

      expect(stepBody(falling, DT, withZero)).toStrictEqual(stepBody(falling, DT, withoutOption))
  })

  it('clamps a bounciness above 1 to 1, so a bounce never gains energy over a perfectly elastic one', () => {
      const options = withWorld(groundUpTo(63), { bouncinessAt: () => 5 })
      const falling = standingOn(63, { y: CentreY(restingCentre(63) + 0.05), vy: -5 })

      const stepped = stepBody(falling, DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.vy).toBeCloseTo(5, 12)
  })

  it('does not bounce a resting body: zero incoming velocity has nothing to reflect', () => {
      // gravityY: BlocksPerSecondSquared(0) as well — with real gravity a "resting" vy: 0 body is
      // nudged to a small negative velocity by this very frame's integration
      // before resolveVertical ever sees it (the same mechanism that lets a
      // resting body re-clamp to the floor every frame), which would make
      // this indistinguishable from a genuine downward impact. The guard
      // under test is against exactly-zero incoming velocity, so gravity is
      // held at 0 to present exactly that.
      const options = withWorld(groundUpTo(63), { bouncinessAt: () => 1 })
      const resting = standingOn(63)

      const stepped = stepBody(resting, DT, options, { gravityY: BlocksPerSecondSquared(0) })

      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(true)
  })

  it('does not affect a ceiling collision', () => {
      const options = withWorld((_bx, by) => by === 0 || by === 3, { bouncinessAt: () => 1 })
      const jumping = standingOn(0, { y: CentreY(3 - Number(HALF_H) - 0.01), vy: 8 })

      const stepped = stepBody(jumping, DT, options)

      expect(stepped.body.y).toBe(3 - Number(HALF_H))
      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(false)
  })

  it('does not affect horizontal collisions', () => {
      const options = withWorld((bx, by) => by === 0 || (bx === 1 && by === 1), { bouncinessAt: () => 1 })
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      expect(stepped.body.x).toBe(1 - HALF_W)
      expect(stepped.body.vx).toBe(0)
  })

  it('PROPERTY: repeated bounces off real gravity never leave a dropped body higher than it started', () => {
      // A natural multi-frame fall, matching the style of the existing
      // 'energy' describe block above, rather than an artificially placed
      // single-frame gap: an arbitrary (gap, velocity) pair fed straight into
      // one resolveVertical call can make the discrete "impact velocity"
      // (this frame's post-gravity vy, per the integrate-then-resolve order)
      // overstate the true contact speed for the actual, much smaller gap —
      // which is a property of the one-step gap/reach approximation itself,
      // not of bounce specifically. A body that actually fell there frame by
      // frame never presents that mismatch.
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 1, max: 10, noNaN: true, noDefaultInfinity: true }),
          (bounciness, dropHeight) => {
            const options = withWorld(groundUpTo(63), { bouncinessAt: () => bounciness })
            const start = standingOn(63, { y: CentreY(restingCentre(63) + dropHeight) })
            let body = start
            const stateKey = (state: Body): string =>
              `${state.x},${state.y},${state.z},${state.vx},${state.vy},${state.vz}`
            const seen = new Set([stateKey(start)])
            for (let frame = 0; frame < 500; frame += 1) {
              body = stepBody(body, DT, options).body
              if (body.y > start.y + 1e-6) {
                return false
              }
              // In this fixed world, a repeated state repeats forever; every state in that cycle was checked.
              const key = stateKey(body)
              if (seen.has(key)) return true
              seen.add(key)
            }
            return true
          },
        ),
        { numRuns: 200 },
      )
  })

  it('PROPERTY: on the frame a genuine downward floor impact is resolved, bounciness > 0 leaves the body moving away from the surface', () => {
      // MUTATION-CAUGHT: the "never higher than it started" property above
      // stays green even if the reflection in resolve-axis.ts
      // (`velocity: -state.velocity * bounciness`) loses its negation — a
      // body that never bounces also never rises above where it started, so
      // that property cannot tell "no reflection" from "correct reflection".
      // This asks the one-sided question directly: bouncinessAt is invoked
      // (in resolveVertical) if and only if a genuine downward floor impact
      // was just resolved, so using it as a marker isolates exactly the
      // frame the reflection must have fired on, and checks vy on that frame
      // is positive rather than merely non-increasing in energy.
      fc.assert(
        fc.property(
          fc.double({ min: 0.05, max: 1, noNaN: true, noDefaultInfinity: true }),
          fc.double({ min: 0.5, max: 6, noNaN: true, noDefaultInfinity: true }),
          (bounciness, dropHeight) => {
            let contactThisFrame = false
            const options = withWorld(groundUpTo(63), {
              bouncinessAt: () => {
                contactThisFrame = true
                return bounciness
              },
            })
            let body = standingOn(63, { y: CentreY(restingCentre(63) + dropHeight) })
            let observedContact = false
            let vyAfterContact = 0

            for (let frame = 0; frame < 500 && !observedContact; frame += 1) {
              contactThisFrame = false
              body = stepBody(body, DT, options).body
              if (contactThisFrame) {
                observedContact = true
                vyAfterContact = body.vy
              }
            }

            return observedContact && vyAfterContact > 0
          },
        ),
        { numRuns: 200 },
      )
  })
})

describe('invalid result propagation', () => {
  it('returns a failure for inverted local geometry through each resolver entry point', () => {
    const invalidShape = localShape({ minX: 0.75, maxX: 0.25, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
    const options = withWorld(() => false, { blockShapeAt: () => invalidShape })
    const body = bodyAt(0.5, 10, 0.5, 0, -1)

    expect(Result.isFailure(resolveBodyResult(body, DT, options))).toBe(true)
    expect(Result.isFailure(resolveWorldResult([body], DT, options))).toBe(true)
    expect(Result.isFailure(stepBodyResult(body, DT, options))).toBe(true)
    expect(Result.isFailure(stepWorldResult([body], DT, options))).toBe(true)
  })

  it('rejects non-positive half-width and negative step-height at the resolver boundary', () => {
    const body = bodyAt(0.5, 10, 0.5)
    const nonPositiveWidth = withWorld(() => false, { halfWidth: 0 })
    const negativeStepHeight = withWorld(() => false, { stepHeight: -0.1 })

    expect(Result.isFailure(resolveBodyResult(body, DT, nonPositiveWidth))).toBe(true)
    expect(Result.isFailure(resolveWorldResult([], DT, nonPositiveWidth))).toBe(true)
    expect(Result.isFailure(stepBodyResult(body, DT, negativeStepHeight))).toBe(true)
    expect(Result.isFailure(stepWorldResult([], DT, negativeStepHeight))).toBe(true)
  })

  it('returns a failure when the tunnelling speed calculation divides by zero', () => {
    const invalidSpeed = maxSpeedWithoutTunnellingResult(
      BlockLength(1),
      BlockLength(1),
      DeltaTimeSecs(0),
    )

    expect(Result.isFailure(invalidSpeed)).toBe(true)
  })
})


describe('resolver Result boundary coverage', () => {
  it('rejects branded coordinate and axis inputs at shape, support, and axis boundaries', () => {
    const options = withWorld(() => false, { halfWidth: 0.3, halfHeight: 0.25 })
    expect(Result.isFailure(blockShapesAtResult(options, Number.NaN, 0, 0))).toBe(true)
    expect(Result.isFailure(blockShapesAtResult(options, 0, Number.MAX_SAFE_INTEGER + 10, 0))).toBe(true)
    expect(Result.isFailure(blockShapesAtResult(options, 0, 0, Number.MAX_SAFE_INTEGER + 10))).toBe(true)

    const invalidBox = {
      minX: Number.MAX_SAFE_INTEGER + 10,
      maxX: Number.MAX_SAFE_INTEGER + 10,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
    }
    expect(Result.isFailure(forEachCollidingBlockResult(
      options,
      // @ts-expect-error -- malformed coordinates exercise resolver validation.
      invalidBox,
      () => undefined,
    ))).toBe(true)
    expect(Result.isFailure(isSupportedResult(
      options,
      // @ts-expect-error -- malformed coordinates exercise resolver validation.
      invalidBox,
    ))).toBe(true)

    const box = boxOf({ kind: 'dynamic', x: 0.5, y: 0.5, z: 0.5, vx: 0, vy: 0, vz: 0 }, HalfHeight(0.25), BlockLength(0.3))
    const invalidState = {
      blocked: false,
      position: Number.NaN,
      velocity: BlocksPerSecond(1),
    }
    expect(Result.isFailure(clampAxisResult(
      // @ts-expect-error -- malformed position exercises resolver validation.
      invalidState,
      box.minX,
      box.maxX,
      options.halfWidth,
      options,
      box,
      {
        nearFace: (block) => block.minX,
        farFace: (block) => block.maxX,
        positionResult: PositionAxis.result,
      },
    ))).toBe(true)
    expect(Result.isFailure(resolveVerticalResult(options, box, {
      blocked: false,
      position: CentreY(0.5),
      // @ts-expect-error -- malformed velocity exercises resolver validation.
      velocity: Number.NaN,
    }, DT))).toBe(true)
    expect(Result.isFailure(resolveVerticalResult(options, box, {
      blocked: false,
      position: CentreY(0.5),
      velocity: BlocksPerSecond(-1),
    },
    // @ts-expect-error -- malformed delta exercises resolver validation.
    Number.NaN))).toBe(true)
    expect(Result.isFailure(resolveVerticalResult(options, box, {
      blocked: false,
      position: CentreY(0.5),
      velocity: BlocksPerSecond(-Number.MAX_VALUE),
    }, DeltaTimeSecs(2)))).toBe(true)
    expect(Result.isFailure(resolveVerticalResult(options, box, {
      blocked: false,
      position: CentreY(0.5),
      velocity: BlocksPerSecond(Number.MAX_VALUE),
    }, DeltaTimeSecs(2)))).toBe(true)
  })

  it('rejects a floor contact whose resolved centre overflows', () => {
    const largeFloor = localShape({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: 1,
      maxY: Number.MAX_VALUE * 0.85,
      maxZ: 1,
    })
    const options = withWorld(() => false, {
      halfHeight: Number.MAX_VALUE * 0.85,
      blockShapeAt: (_bx, by) => by === 0 ? largeFloor : null,
    })
    const box = boxOf({ kind: 'dynamic', x: 0.5, y: 0.5, z: 0.5, vx: 0, vy: 0, vz: 0 }, HalfHeight(0.25), BlockLength(0.3))

    expect(Result.isFailure(resolveVerticalResult(options, box, {
      blocked: false,
      position: CentreY(0.5),
      velocity: BlocksPerSecond(-Number.MAX_VALUE * 0.45),
    }, DeltaTimeSecs(2)))).toBe(true)
  })

  it('clamps both horizontal directions and resolves downward floors and upward ceilings', () => {
    const box = boxOf({ kind: 'dynamic', x: 0.5, y: 0.5, z: 0.5, vx: 0, vy: 0, vz: 0 }, HalfHeight(0.25), BlockLength(0.3))
    const positiveWall = localShape({ minX: 0.7, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
    const positiveOptions = withWorld(() => false, {
      halfWidth: 0.3,
      halfHeight: 0.25,
      blockShapeAt: () => positiveWall,
    })
    const positive = unwrap(clampAxisResult(
      { blocked: false, position: PositionAxis(0.5), velocity: BlocksPerSecond(1) },
      box.minX,
      box.maxX,
      positiveOptions.halfWidth,
      positiveOptions,
      box,
      {
        nearFace: (block) => block.minX,
        farFace: (block) => block.maxX,
        positionResult: PositionAxis.result,
      },
    ))
    expect(positive.blocked).toBe(true)
    expect(positive.position).toBeCloseTo(0.4)
    expect(positive.velocity).toBe(0)

    const negativeWall = localShape({ minX: 0, maxX: 0.3, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
    const negativeOptions = withWorld(() => false, {
      halfWidth: 0.3,
      halfHeight: 0.25,
      blockShapeAt: () => negativeWall,
    })
    const negative = unwrap(clampAxisResult(
      { blocked: false, position: PositionAxis(0.5), velocity: BlocksPerSecond(-1) },
      box.minX,
      box.maxX,
      negativeOptions.halfWidth,
      negativeOptions,
      box,
      {
        nearFace: (block) => block.minX,
        farFace: (block) => block.maxX,
        positionResult: PositionAxis.result,
      },
    ))
    expect(negative.blocked).toBe(true)
    expect(negative.position).toBeCloseTo(0.6)
    expect(negative.velocity).toBe(0)

    const fullBlock = localShape({ minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
    const floorOptions = withWorld(() => false, {
      halfWidth: 0.3,
      halfHeight: 1,
      blockShapeAt: (_bx, by) => by === 1 ? fullBlock : null,
    })
    const floor = unwrap(resolveVerticalResult(floorOptions, boxOf({
      kind: 'dynamic', x: 0.5, y: 2.9, z: 0.5, vx: 0, vy: -4, vz: 0,
    }, HalfHeight(1), BlockLength(0.3)), {
      blocked: false,
      position: CentreY(2.9),
      velocity: BlocksPerSecond(-4),
    }, DT))
    expect(floor).toMatchObject({ blocked: true, position: 3, velocity: 0 })

    const ceilingOptions = withWorld(() => false, {
      halfWidth: 0.3,
      halfHeight: 1,
      blockShapeAt: (_bx, by) => by === 2 ? fullBlock : null,
    })
    const ceiling = unwrap(resolveVerticalResult(ceilingOptions, boxOf({
      kind: 'dynamic', x: 0.5, y: 1.1, z: 0.5, vx: 0, vy: 4, vz: 0,
    }, HalfHeight(1), BlockLength(0.3)), {
      blocked: false,
      position: CentreY(1.1),
      velocity: BlocksPerSecond(4),
    }, DT))
    expect(ceiling).toMatchObject({ blocked: true, position: 1, velocity: 0 })
  })

  it('propagates shape and dimension failures through horizontal, support, and step resolution', () => {
    const invalidShape = localShape({ minX: 0.75, maxX: 0.25, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
    const invalidShapeOptions = withWorld(() => false, {
      halfWidth: 0.3,
      halfHeight: 0.5,
      stepHeight: 0.5,
      blockShapeAt: () => invalidShape,
    })
    const horizontalBody = bodyAt(0.5, 1.5, 0.5, 1, 0, 0)
    expect(Result.isFailure(resolveBodyResult(horizontalBody, DT, invalidShapeOptions))).toBe(true)
    const invalidShapeBox = boxOf(
      { kind: 'dynamic', x: 0.5, y: 1.5, z: 0.5, vx: 0, vy: 0, vz: 0 },
      HalfHeight(0.5),
      BlockLength(0.3),
    )
    expect(Result.isFailure(clampAxisResult(
      { blocked: false, position: PositionAxis(0.5), velocity: BlocksPerSecond(-1) },
      invalidShapeBox.minX,
      invalidShapeBox.maxX,
      invalidShapeOptions.halfWidth,
      invalidShapeOptions,
      invalidShapeBox,
      {
        nearFace: (block) => block.minX,
        farFace: (block) => block.maxX,
        positionResult: PositionAxis.result,
      },
    ))).toBe(true)
    expect(Result.isFailure(resolveVerticalResult(invalidShapeOptions, invalidShapeBox, {
      blocked: false,
      position: CentreY(1.5),
      velocity: BlocksPerSecond(-1),
    }, DT))).toBe(true)
    expect(Result.isFailure(resolveVerticalResult(invalidShapeOptions, invalidShapeBox, {
      blocked: false,
      position: CentreY(1.5),
      velocity: BlocksPerSecond(1),
    }, DT))).toBe(true)
    expect(Result.isFailure(resolveBodyResult(bodyAt(0.5, 10, 0.5, 0, 0, 1), DT, invalidShapeOptions))).toBe(true)
    expect(Result.isFailure(stepBodyResult(bodyAt(0.5, 10, 0.5, 100, 0, 0), DT, invalidShapeOptions))).toBe(true)
    expect(Result.isFailure(isSupportedResult(
      invalidShapeOptions,
      boxOf({ kind: 'dynamic', x: 0.5, y: 1.5, z: 0.5, vx: 0, vy: 0, vz: 0 }, HalfHeight(0.5), BlockLength(0.3)),
    ))).toBe(true)

    const stationaryBody = bodyAt(0.5, 1.5, 0.5)
    const blockedX = { blocked: true, position: stationaryBody.x, velocity: stationaryBody.vx }
    const freeZ = { blocked: false, position: stationaryBody.z, velocity: stationaryBody.vz }
    expect(Result.isFailure(tryStepUpResult(
      stationaryBody,
      stationaryBody.y,
      blockedX,
      freeZ,
      BlocksPerSecond(0),
      invalidShapeOptions,
    ))).toBe(true)

    expect(Result.isFailure(tryStepUpResult(
      stationaryBody,
      stationaryBody.y,
      blockedX,
      freeZ,
      BlocksPerSecond(0),
      {
        ...invalidShapeOptions,
        // @ts-expect-error -- malformed step height exercises resolver validation.
        stepHeight: Number.NaN,
      },
    ))).toBe(true)
    expect(Result.isFailure(tryStepUpResult(
      stationaryBody,
      stationaryBody.y,
      blockedX,
      freeZ,
      // @ts-expect-error -- malformed velocity exercises resolver validation.
      Number.NaN,
      invalidShapeOptions,
    ))).toBe(true)
    expect(Result.isFailure(tryStepUpResult(
      stationaryBody,
      stationaryBody.y,
      blockedX,
      freeZ,
      BlocksPerSecond(0),
      { ...invalidShapeOptions, stepHeight: BlockLength(-0.1) },
    ))).toBe(true)

    const overflowHeightOptions = withWorld(() => false, {
      halfWidth: 0.3,
      halfHeight: 0.5,
      stepHeight: Number.MAX_VALUE,
    })
    expect(Result.isFailure(tryStepUpResult(
      stationaryBody,
      CentreY(Number.MAX_VALUE),
      blockedX,
      freeZ,
      BlocksPerSecond(0),
      overflowHeightOptions,
    ))).toBe(true)

    const overflowBoxOptions = withWorld(() => false, {
      halfWidth: Number.MAX_VALUE / 2,
      halfHeight: 0.5,
      stepHeight: 0.5,
    })
    const edgeBody = bodyAt(Number.MAX_VALUE, 1.5, 0.5)
    expect(Result.isFailure(tryStepUpResult(
      edgeBody,
      edgeBody.y,
      { blocked: true, position: edgeBody.x, velocity: edgeBody.vx },
      { blocked: false, position: edgeBody.z, velocity: edgeBody.vz },
      BlocksPerSecond(0),
      overflowBoxOptions,
    ))).toBe(true)

    const raisedXBody = bodyAt(0.5, 1.5, 0.5, 1, 0, 0)
    expect(Result.isFailure(tryStepUpResult(
      raisedXBody,
      raisedXBody.y,
      { blocked: true, position: raisedXBody.x, velocity: raisedXBody.vx },
      { blocked: false, position: raisedXBody.z, velocity: raisedXBody.vz },
      BlocksPerSecond(0),
      invalidShapeOptions,
    ))).toBe(true)

    const raisedZBody = bodyAt(0.5, 1.5, 0.5, 0, 0, 1)
    expect(Result.isFailure(tryStepUpResult(
      raisedZBody,
      raisedZBody.y,
      { blocked: false, position: raisedZBody.x, velocity: raisedZBody.vx },
      { blocked: true, position: raisedZBody.z, velocity: raisedZBody.vz },
      BlocksPerSecond(0),
      invalidShapeOptions,
    ))).toBe(true)

    const fullShape = localShape({ minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
    const retryInvalidShape = withWorld(() => false, {
      halfWidth: 0.3,
      halfHeight: 0.5,
      stepHeight: 0.5,
      blockShapeAt: (bx, by, bz) => {
        if (by === 2) return invalidShape
        if (bx === 1 && by === 1 && bz === 0) return fullShape
        return null
      },
    })
    expect(Result.isFailure(resolveBodyResult(
      bodyAt(1, 1.4, 0.5, 0.5, 0, 0),
      DT,
      retryInvalidShape,
    ))).toBe(true)

    const noSupport = tryStepUpResult(
      stationaryBody,
      stationaryBody.y,
      blockedX,
      freeZ,
      BlocksPerSecond(0),
      withWorld(() => false, { stepHeight: 0.5 }),
    )
    expect(noSupport).toEqual(Result.succeed(null))

    const noHorizontalAttempt = tryStepUpResult(
      stationaryBody,
      stationaryBody.y,
      { blocked: false, position: stationaryBody.x, velocity: stationaryBody.vx },
      { blocked: false, position: stationaryBody.z, velocity: stationaryBody.vz },
      BlocksPerSecond(0),
      withWorld(() => false, { stepHeight: 0.5 }),
    )
    expect(noHorizontalAttempt).toEqual(Result.succeed(null))
  })

  it('propagates finite-geometry failures after step-up validation', () => {
    const blockedX = { blocked: true, position: PositionAxis(0.5), velocity: BlocksPerSecond(0) }
    const freeZ = { blocked: false, position: PositionAxis(0.5), velocity: BlocksPerSecond(0) }
    const huge = Number.MAX_VALUE

    const horizontalBoxFailure = tryStepUpResult(
      bodyAt(0.5, -huge * 0.75, 0.5),
      CentreY(-huge * 0.75),
      blockedX,
      freeZ,
      BlocksPerSecond(0),
      withWorld(() => false, {
        halfWidth: 0.5,
        halfHeight: huge * 0.4,
        stepHeight: huge * 0.5,
      }),
    )
    expect(Result.isFailure(horizontalBoxFailure)).toBe(true)

    let xReads = 0
    const changingXBody: Body = {
      ...bodyAt(0.5, 1.5, 0.5),
      get x() {
        xReads += 1
        return xReads === 1 ? PositionAxis(0.5) : PositionAxis(Number.MAX_VALUE)
      },
    }
    const raisedAfterXFailure = tryStepUpResult(
      changingXBody,
      CentreY(1.5),
      blockedX,
      freeZ,
      BlocksPerSecond(0),
      withWorld(() => false, { halfWidth: huge / 2, stepHeight: 0.5 }),
    )
    expect(Result.isFailure(raisedAfterXFailure)).toBe(true)
  })

  it('rejects an invalid block coordinate derived from a colliding custom floor', () => {
    const extendedShape = localShape({
      minX: -Number.MAX_VALUE,
      maxX: 1,
      minY: 0,
      maxY: 1,
      minZ: 0,
      maxZ: 1,
    })
    const options = withWorld(() => false, {
      halfWidth: 0.3,
      halfHeight: 1,
      blockShapeAt: (_bx, by) => by === 1 ? extendedShape : null,
    })
    const falling = { kind: 'dynamic', x: 0.5, y: 2.9, z: 0.5, vx: 0, vy: -4, vz: 0 } as const
    const result = resolveVerticalResult(options, boxOf(falling, HalfHeight(1), BlockLength(0.3)), {
      blocked: false,
      position: CentreY(2.9),
      velocity: BlocksPerSecond(-4),
    }, DT)

    expect(Result.isFailure(result)).toBe(true)
  })

  it('validates swept-motion inputs and handles each collision axis', () => {
    const empty = withWorld(() => false, { halfWidth: 0.25, halfHeight: 0.25 })
    const start = bodyAt(0.5, 0.5, 0.5)
    expect(Result.isSuccess(resolveSweptMotionResult(start, bodyAt(0.6, 0.5, 0.5), empty))).toBe(true)
    expect(Result.isFailure(resolveSweptMotionResult(
      // @ts-expect-error -- malformed coordinates exercise swept-motion validation.
      { ...start, x: Number.NaN },
      start,
      empty,
    ))).toBe(true)
    expect(Result.isFailure(resolveSweptMotionResult(start, bodyAt(2.5, 0.5, 0.5), {
      ...empty,
      // @ts-expect-error -- malformed dimensions exercise swept-motion validation.
      halfWidth: Number.NaN,
    }))).toBe(true)
    expect(Result.isFailure(resolveSweptMotionResult(
      bodyAt(Number.MAX_VALUE, 0.5, 0.5),
      start,
      { ...empty, halfWidth: BlockLength(Number.MAX_VALUE / 2) },
    ))).toBe(true)
    expect(Result.isFailure(resolveSweptMotionResult(start, bodyAt(Number.MAX_VALUE, 0.5, 0.5), {
      ...empty,
      halfWidth: BlockLength(Number.MAX_VALUE / 2),
    }))).toBe(true)

    const fullBlock = localShape({ minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
    const wallResult = resolveSweptMotionResult(start, bodyAt(2.5, 0.5, 0.5), {
      ...empty,
      blockShapeAt: (bx, by, bz) => bx === 1 && by === 0 && bz === 0 ? fullBlock : null,
    })
    expect(unwrap(wallResult).vx).toBe(0)

    const floorResult = resolveSweptMotionResult(start, bodyAt(0.5, 2.5, 0.5), {
      ...empty,
      blockShapeAt: (bx, by, bz) => bx === 0 && by === 1 && bz === 0 ? fullBlock : null,
    })
    expect(unwrap(floorResult).vy).toBe(0)

    const zWallResult = resolveSweptMotionResult(start, bodyAt(0.5, 0.5, 2.5), {
      ...empty,
      blockShapeAt: (bx, by, bz) => bx === 0 && by === 0 && bz === 1 ? fullBlock : null,
    })
    expect(unwrap(zWallResult).vz).toBe(0)

    const invalidShape = localShape({ minX: 0.75, maxX: 0.25, minY: 0, maxY: 1, minZ: 0, maxZ: 1 })
    expect(Result.isFailure(resolveSweptMotionResult(start, bodyAt(2.5, 0.5, 0.5), {
      ...empty,
      blockShapeAt: () => invalidShape,
    }))).toBe(true)
  })

  it('propagates invalid resolver values and contact hazard sampling failures', () => {
    const options = withWorld(() => false)
    const body = bodyAt(0.5, 10, 0.5)
    const invalidOptions = { ...options, halfWidth: Number.NaN }
    expect(Result.isFailure(resolveBodyResult(
      body,
      DT,
      // @ts-expect-error -- malformed dimensions exercise resolver validation.
      invalidOptions,
    ))).toBe(true)
    expect(Result.isFailure(resolveWorldResult(
      [body],
      // @ts-expect-error -- malformed delta exercises resolver validation.
      Number.NaN,
      options,
    ))).toBe(true)
    expect(Result.isFailure(resolveBodyResult(
      body,
      // @ts-expect-error -- malformed delta exercises resolver validation.
      Number.NaN,
      options,
    ))).toBe(true)
    expect(Result.isFailure(stepBodyResult(
      body,
      // @ts-expect-error -- malformed delta exercises resolver validation.
      Number.NaN,
      options,
    ))).toBe(true)
    expect(Result.isFailure(stepWorldResult(
      [],
      // @ts-expect-error -- malformed delta exercises resolver validation.
      Number.NaN,
      options,
    ))).toBe(true)
    expect(Result.isFailure(resolveBodyResult(
      // @ts-expect-error -- malformed position exercises resolver validation.
      { ...body, x: Number.NaN },
      DT,
      options,
    ))).toBe(true)
    expect(Result.isFailure(stepBodyResult(
      // @ts-expect-error -- malformed velocity exercises resolver validation.
      { ...body, vx: Number.NaN },
      DT,
      options,
    ))).toBe(true)
    expect(Result.isFailure(maxSpeedWithoutTunnellingResult(
      // @ts-expect-error -- malformed size exercises tunnelling-guard validation.
      Number.NaN,
      BlockLength(1),
      DeltaTimeSecs(1),
    ))).toBe(true)

    const cactus = sampleOf('cactus')
    const hazardousSample = {
      ...cactus,
      properties: {
        ...cactus.properties,
        contactDamage: Number.NaN,
      },
    }
    const hazardousOptions = withWorld(() => false, {
      environment: {
        // @ts-expect-error -- malformed hazard data exercises environment validation.
        blockAt: () => hazardousSample,
      },
    })
    const staticBody: Body = { ...bodyAt(0.5, 0.5, 0.5), kind: 'static' }
    expect(Result.isFailure(resolveBodyResult(staticBody, DT, hazardousOptions))).toBe(true)
  })

  it('propagates failed AABB reconstruction after vertical and horizontal resolution', () => {
    const options = withWorld(() => false, { halfWidth: 0.5, halfHeight: 0.5 })
    const changingBody = (values: ReadonlyArray<number>, vx = 0, vz = 0) => {
      let reads = 0
      const body: Body = {
        ...bodyAt(0.5, 1.5, 0.5, vx, 0, vz),
        // @ts-expect-error -- malformed coordinates exercise reconstruction validation.
        get x() {
          const value = values.at(Math.min(reads, values.length - 1))
          reads += 1
          if (value === undefined) throw new Error('Expected a scripted coordinate sample')
          if (Number.isNaN(value)) {
            return Number.NaN
          }
          return PositionAxis(value)
        },
      }
      return { body, reads: () => reads }
    }

    const verticalBox = changingBody([0.5, 0.5, Number.NaN])
    expect(Result.isFailure(resolveBodyResult(verticalBox.body, DT, options))).toBe(true)
    expect(verticalBox.reads()).toBe(3)

    const boxAfterY = changingBody([0.5, Number.NaN], 1)
    expect(Result.isFailure(resolveBodyResult(boxAfterY.body, DT, options))).toBe(true)
    expect(boxAfterY.reads()).toBe(2)

    const boxAfterX = changingBody([0.5, 0.5, Number.MAX_VALUE], 0, 1)
    expect(Result.isFailure(resolveBodyResult(boxAfterX.body, DT, withWorld(() => false, {
      halfWidth: Number.MAX_VALUE / 2,
      halfHeight: 0.5,
    })))).toBe(true)
    expect(boxAfterX.reads()).toBe(3)
  })
})
