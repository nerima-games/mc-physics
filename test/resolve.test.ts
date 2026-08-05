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
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck } from 'effect'
import {
  CACTUS_SHAPE,
  CONTACT_EPSILON,
  CentreY,
  HalfHeight,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  PRESSURE_PLATE_SHAPE,
  SLAB_SHAPE,
  blockAABB,
  centreOfFoot,
  collidesWith,
  entityAABB,
  intersects,
  isRestingOn,
  penetrationY,
  standingPlaneAbove,
} from '../src/domain/coordinates'
import { MAX_DELTA_SECS, MIN_DELTA_SECS, clampDeltaTime } from '../src/domain/delta-time'
import { GRAVITY_Y, TERMINAL_VELOCITY_Y, integrateBody, maxFallPerStep, type Body } from '../src/domain/integrate'
import {
  clampSneakEdge,
  maxSpeedWithoutTunnelling,
  resolveBody,
  resolveWorld,
  stepBody,
  stepWorld,
  type IsBlockSolid,
  type ResolveOptions,
} from '../src/domain/resolve'

const HALF_W = PLAYER_HALF_WIDTH
const HALF_H = PLAYER_HALF_HEIGHT
const DT = clampDeltaTime(0.02)

/**
 * The fastest the reference's player ever moves horizontally: a sprint (5.612)
 * times the sprint-jump multiplier (1.2), from
 * `packages/entity/application/movement-service.ts:25-32`. It lives here rather
 * than in `domain/` because it is a gameplay value and belongs to mc-sim
 * (`docs/responsibility.md` §3) — the resolver only needs to be safe at it.
 */
const REFERENCE_TOP_SPEED = 5.612 * 1.2

/** Solid everywhere up to and including `topCell`; air above. A world floor. */
const groundUpTo =
  (topCell: number): IsBlockSolid =>
  (_bx, by) =>
    by <= topCell

const withWorld = (isBlockSolid: IsBlockSolid, extra: Partial<ResolveOptions> = {}): ResolveOptions => ({
  halfWidth: HALF_W,
  halfHeight: HALF_H,
  isBlockSolid,
  ...extra,
})

/** The centre Y at which a body of PLAYER_HALF_HEIGHT rests on top of `surfaceCell`. */
const restingCentre = (surfaceCell: number): CentreY => centreOfFoot(standingPlaneAbove(surfaceCell), HALF_H)

const standingOn = (surfaceCell: number, over: Partial<Body> = {}): Body => ({
  kind: 'dynamic',
  x: 0.5,
  y: restingCentre(surfaceCell),
  z: 0.5,
  vx: 0,
  vy: 0,
  vz: 0,
  ...over,
})

const boxOf = (body: Body, halfHeight = HALF_H, halfWidth = HALF_W) =>
  entityAABB(body.x, body.y, body.z, halfWidth, halfHeight)

/** Does the body overlap any block by more than the contact skin? */
const penetratesSomething = (body: Body, options: ResolveOptions): boolean => {
  const box = boxOf(body, options.halfHeight, options.halfWidth)
  for (let bx = Math.floor(box.minX) - 1; bx <= Math.floor(box.maxX) + 1; bx += 1) {
    for (let by = Math.floor(box.minY) - 1; by <= Math.floor(box.maxY) + 1; by += 1) {
      for (let bz = Math.floor(box.minZ) - 1; bz <= Math.floor(box.maxZ) + 1; bz += 1) {
        const shape = options.blockShapeAt?.(bx, by, bz) ?? null
        const solid = shape !== null || options.isBlockSolid(bx, by, bz)
        if (solid && collidesWith(box, blockAABB(bx, by, bz, shape ?? undefined))) {
          return true
        }
      }
    }
  }
  return false
}

/** Kinetic plus gravitational potential energy, per unit mass. */
const energyOf = (body: Body): number =>
  0.5 * (body.vx * body.vx + body.vy * body.vy + body.vz * body.vz) + Math.abs(GRAVITY_Y) * body.y

describe('sneak edge prevention', () => {
  const insideSupport = 0.75
  const outsideSupport = 1.25
  const supportLimit = 1
  const supported = (positionX: number, positionZ: number): boolean =>
    positionX <= supportLimit && positionZ <= supportLimit

  it.effect('keeps movement on supported ground unchanged', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('clamps only the axis that would cross an unsupported edge', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('clamps both axes when each independent move loses support', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('does not query support for an axis that did not move', () =>
    Effect.sync(() => {
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
    }),
  )
})

describe('standard non-cubic block shapes', () => {
  it.effect('lands on the pressure plate top face rather than the cell top', () =>
    Effect.sync(() => {
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 0 && by === 0 && bz === 0 ? PRESSURE_PLATE_SHAPE : null),
      })
      const falling: Body = { ...standingOn(0), y: CentreY(Number(HALF_H) + 1 / 16 + 0.01), vy: -1 }

      const stepped = stepBody(falling, DT, options, 0)

      expect(stepped.body.y).toBe(Number(HALF_H) + 1 / 16)
      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(true)
    }),
  )

  it.effect('allows movement before the cactus inset and clamps exactly at it', () =>
    Effect.sync(() => {
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 1 && by === 1 && bz === 0 ? CACTUS_SHAPE : null),
      })
      const before: Body = { ...standingOn(0), x: 0.74, y: CentreY(1.5), vx: 1 }
      const crossing: Body = { ...before, x: 0.75 }

      const unobstructed = stepBody(before, DT, options, 0)
      const blocked = stepBody(crossing, DT, options, 0)

      expect(unobstructed.body.x).toBe(0.74 + DT)
      expect(unobstructed.body.vx).toBe(1)
      expect(blocked.body.x).toBe(1 + 1 / 16 - HALF_W)
      expect(blocked.body.vx).toBe(0)
    }),
  )

  it.effect('resolves the same shaped-block input deterministically', () =>
    Effect.sync(() => {
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 1 && by === 1 && bz === 0 ? CACTUS_SHAPE : null),
      })
      const body: Body = { ...standingOn(0), x: 0.75, y: CentreY(1.5), vx: 1 }

      expect(stepBody(body, DT, options, 0)).toStrictEqual(stepBody(body, DT, options, 0))
    }),
  )
})

// ---------------------------------------------------------------------------
// AXIS ORDER — physics-resolve-y-before-x
// ---------------------------------------------------------------------------

describe('the axis order is Y, then X, then Z', () => {
  it.effect('a body walking along flat ground crosses the seam between two floor blocks', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('and keeps crossing them: a hundred frames of walking travel the whole distance', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('Y before X: a body falling onto a ledge does not embed sideways', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('Y before X is what makes step-up work without a second horizontal pass', () =>
    Effect.sync(() => {
      // A slab in the column ahead. The Y phase lifts the body onto it, so by
      // the time X runs there is nothing to collide with. Resolve X first and
      // the slab is a wall, which is the case the reference recovers with a
      // whole second horizontal pass (`aabb-collision.ts:303-318`).
      const isSlab = (bx: number, by: number): boolean => bx === 1 && by === 1
      const options = withWorld((bx, by) => by === 0 || isSlab(bx, by), {
        blockShapeAt: (bx, by) => (isSlab(bx, by) ? SLAB_SHAPE : null),
        stepHeight: 0.6,
      })
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      // Lifted onto the slab's top face at y = 1.5, not stopped in front of it.
      expect(stepped.body.y).toBe(1.5 + Number(HALF_H))
      expect(stepped.body.x).toBe(0.85 + REFERENCE_TOP_SPEED * DT)
      expect(stepped.body.vx).toBe(REFERENCE_TOP_SPEED)
      expect(stepped.isGrounded).toBe(true)
    }),
  )

  it.effect('with no step height injected, the same slab is a wall', () =>
    Effect.sync(() => {
      // The mechanism is here, the value is mc-sim's (docs/responsibility.md
      // §3). Default zero means the resolver on its own never lifts a body onto
      // anything it did not fall onto.
      const isSlab = (bx: number, by: number): boolean => bx === 1 && by === 1
      const options = withWorld((bx, by) => by === 0 || isSlab(bx, by), {
        blockShapeAt: (bx, by) => (isSlab(bx, by) ? SLAB_SHAPE : null),
      })
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      expect(stepped.body.x).toBe(1 - HALF_W)
      expect(stepped.body.vx).toBe(0)
      expect(stepped.body.y).toBe(restingCentre(0))
    }),
  )

  it.effect('Z is resolved against the X the previous phase corrected, so a body slides along a wall', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('walking into an inside corner stops on both axes without either phase teleporting the body', () =>
    Effect.sync(() => {
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
    }),
  )
})

describe('continuous collision for high-speed steps', () => {
  const FAST_DT = clampDeltaTime(MAX_DELTA_SECS)

  it.effect('stops at the first wall crossed, even after crossing several empty voxels', () =>
    Effect.sync(() => {
      const options = withWorld((bx, by, bz) => by === 0 || (bx === 2 && by === 1 && bz === 0))
      const fast = standingOn(0, { vx: 100 })

      const stepped = stepBody(fast, FAST_DT, options, 0)

      expect(stepped.body.x).toBeCloseTo(2 - HALF_W, 12)
      expect(stepped.body.vx).toBe(0)
      expect(stepped.body.y).toBe(fast.y)
    }),
  )

  it.effect('does not tunnel through a thin collision shape', () =>
    Effect.sync(() => {
      const thin = { minX: 0.45, maxX: 0.55, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
      const options = withWorld(() => false, {
        blockShapeAt: (bx, by, bz) => (bx === 2 && by === 1 && bz === 0 ? thin : null),
      })
      const fast = standingOn(0, { vx: 100 })

      const stepped = stepBody(fast, FAST_DT, options, 0)

      expect(stepped.body.x).toBeCloseTo(2.45 - HALF_W, 12)
      expect(stepped.body.vx).toBe(0)
    }),
  )

  it.effect('catches a ceiling crossed by a high-speed vertical launch', () =>
    Effect.sync(() => {
      const options = withWorld((bx, by, bz) => bx === 0 && by === 4 && bz === 0)
      const rising: Body = { ...standingOn(0), y: CentreY(1.5), vy: 100 }

      const stepped = stepBody(rising, FAST_DT, options, 0)

      expect(stepped.body.y).toBeCloseTo(4 - Number(HALF_H), 12)
      expect(stepped.body.vy).toBe(0)
    }),
  )

  it.effect('resolves a diagonal corner deterministically on both horizontal axes', () =>
    Effect.sync(() => {
      const options = withWorld((bx, by, bz) => bx === 2 && by === 1 && bz === 2)
      const diagonal = standingOn(0, { vx: 100, vz: 100 })

      const first = stepBody(diagonal, FAST_DT, options, 0)
      const second = stepBody(diagonal, FAST_DT, options, 0)

      expect(first).toStrictEqual(second)
      expect(first.body.x).toBeCloseTo(2 - HALF_W, 12)
      expect(first.body.z).toBeCloseTo(2 - HALF_W, 12)
      expect(first.body.vx).toBe(0)
      expect(first.body.vz).toBe(0)
    }),
  )

  it.effect('selects the earliest hit rather than the first candidate returned by the world', () =>
    Effect.sync(() => {
      const options = withWorld((bx, by, bz) =>
        (bx === 1 && by === 5 && bz === 0) || (bx === 2 && by === 3 && bz === 0),
      )
      const diagonal: Body = { ...standingOn(0), y: CentreY(1.5), vx: 50, vy: 100 }

      const stepped = stepBody(diagonal, FAST_DT, options, 0)

      expect(stepped.body.x).toBeCloseTo(2 - HALF_W, 12)
      expect(stepped.body.vx).toBe(0)
    }),
  )

  it.effect('uses Y before X when two swept faces are reached simultaneously', () =>
    Effect.sync(() => {
      const options = withWorld((bx, by, bz) =>
        (bx === 1 && by === 4 && bz === 0) || (bx === 2 && by === 2 && bz === 0),
      )
      const diagonal: Body = { ...standingOn(0), y: CentreY(1.5), vx: 75, vy: 100 }

      const stepped = stepBody(diagonal, FAST_DT, options, 0)

      expect(stepped.body.y).toBeCloseTo(4 - Number(HALF_H), 12)
      expect(stepped.body.vy).toBe(0)
    }),
  )

  it.effect('blocks motion into an initial contact but permits motion away from it', () =>
    Effect.sync(() => {
      const options = withWorld((bx, by, bz) => bx === 1 && by === 1 && bz === 0)
      const touching = standingOn(0, { x: 1 - HALF_W })

      const inward = stepBody({ ...touching, vx: 100 }, FAST_DT, options, 0)
      const outward = stepBody({ ...touching, vx: -100 }, FAST_DT, options, 0)

      expect(inward.body.x).toBe(touching.x)
      expect(inward.body.vx).toBe(0)
      expect(outward.body.x).toBeCloseTo(touching.x - 5, 12)
      expect(outward.body.vx).toBe(-100)
    }),
  )

  it.effect('does not turn a pre-existing overlap into a trap', () =>
    Effect.sync(() => {
      const options = withWorld((bx, by, bz) => bx === 1 && by === 1 && bz === 0)
      const overlapping = standingOn(0, { x: 1.5, vx: -100 })

      const escaped = stepBody(overlapping, FAST_DT, options, 0)

      expect(escaped.body.x).toBeCloseTo(-3.5, 12)
      expect(escaped.body.vx).toBe(-100)
    }),
  )
})

// ---------------------------------------------------------------------------
// THE GROUND CLAMP AND ITS ORDER — physics-resolve-runs-after-integrate (P-3)
// ---------------------------------------------------------------------------

describe('the ground clamp lives inside the resolver and runs after integrate', () => {
  it.effect('a body falling onto a floor is clamped to it, with its downward velocity zeroed', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('REGRESSION: reversing the order leaves the body sunk one frame’s fall INTO the floor', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('a body pushed up into a ceiling stops there and is not grounded', () =>
    Effect.sync(() => {
      const options = withWorld((_bx, by) => by === 0 || by === 3)
      // Head 1 cm under the ceiling's underside at y = 3, moving up at 8 m/s:
      // one step would put the head 0.146 through it.
      const jumping = standingOn(0, { y: CentreY(3 - Number(HALF_H) - 0.01), vy: 8 })

      const stepped = stepBody(jumping, DT, options)

      expect(stepped.body.y).toBe(3 - Number(HALF_H))
      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(false)
    }),
  )

  it.effect('a wall is not a floor: walking into a full block does not climb it', () =>
    Effect.sync(() => {
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
    }),
  )
})

// ---------------------------------------------------------------------------
// RESTING CONTACT — physics-resting-contact-is-not-a-collision (P-6)
// ---------------------------------------------------------------------------

describe('resting contact', () => {
  it.effect('a body lands in exactly the state test/coordinates.test.ts documents', () =>
    Effect.sync(() => {
      // The counterexample the coordinate property test found: surfaceY = 1,
      // halfHeight = 0.05. `intersects` IS true, `isRestingOn` is true, and the
      // penetration is a positive number smaller than 1e-15. The resolver has
      // to land the body in that state and leave it there — the epsilon is in
      // the PREDICATE, and `floorTop + halfHeight` is written out exactly, with
      // nothing added to lift the body clear.
      const halfHeight = HalfHeight(0.05)
      const options = withWorld(groundUpTo(1), { halfHeight })
      const falling: Body = {
        kind: 'dynamic',
        x: 0.5,
        y: centreOfFoot(standingPlaneAbove(1), halfHeight),
        z: 0.5,
        vx: 0,
        vy: 0,
        vz: 0,
      }

      const landed = stepBody(falling, DT, options).body
      const box = entityAABB(landed.x, CentreY(landed.y), landed.z, HALF_W, halfHeight)
      const block = blockAABB(0, 1, 0)

      expect(landed.y).toBe(centreOfFoot(standingPlaneAbove(1), halfHeight))
      expect(intersects(box, block)).toBe(true)
      expect(isRestingOn(box, block)).toBe(true)
      expect(penetrationY(box, block)).toBeGreaterThan(0)
      expect(penetrationY(box, block)).toBeLessThan(1e-15)
    }),
  )

  it.effect('a resting body does not drift by one ulp per frame, for a thousand frames', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('resolving is a fixed point: a resolved body resolves to itself, bit for bit', () =>
    Effect.sync(() => {
      // Idempotence is what says the resolver has no opinion left to act on.
      // `isGrounded` is part of it, and it is the part that costs something:
      // taking it from the Y phase, as the reference does (`isGrounded = true`
      // beside the ground clamp), makes the first answer true and the second
      // false for the same body in the same place. The generator has to land
      // bodies for that to show, which is why it integrates first — a body
      // resolved from the air has nothing to clamp and would agree either way.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -0.05, max: 2, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -12, max: 4, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -8, max: 8, noNaN: true, noDefaultInfinity: true }),
          (height, vy, vx) => {
            const options = withWorld(groundUpTo(63))
            const start = standingOn(63, { y: CentreY(restingCentre(63) + height), vy, vx })
            const once = resolveBody(integrateBody(start, DT), DT, options)
            const twice = resolveBody(once.body, DT, options)
            return JSON.stringify(once) === JSON.stringify(twice)
          },
        ),
        { numRuns: 300 },
      )
    }),
  )

  it.effect('PROPERTY: no phase moves a body further than that phase can justify', () =>
    Effect.sync(() => {
      // The bound that keeps a correction from becoming a teleport, and the
      // only thing standing between the two horizontal phases and the inside
      // corner: a face already BEHIND the body is not one it came in through,
      // and resolving against it would move the body further than its own
      // width. Vertically the bound is the distance actually travelled plus
      // whatever step height was injected — which is the same statement as "a
      // wall is not a floor", made quantitative.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: 63.5, max: 68, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -0.5, max: 2.5, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -12, max: 12, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -12, max: 12, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -12, max: 12, noNaN: true, noDefaultInfinity: true }),
          (y, x, vx, vy, vz) => {
            // Terrain with an inside corner and an overhang to aim at.
            const options = withWorld(
              (bx, by, bz) => by <= 63 || (by <= 66 && (bx === 1 || bz === 1)) || (by === 67 && bx === 0),
            )
            const body: Body = { kind: 'dynamic', x, y: CentreY(y), z: 0.5, vx, vy, vz }
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
    }),
  )
})

// ---------------------------------------------------------------------------
// ZERO PENETRATION — plan.md §3.4
// ---------------------------------------------------------------------------

describe('zero penetration', () => {
  /**
   * A periodic heightmap: column (bx, bz) is solid up to `heights[...]`. Infinite
   * in both directions so a body can never walk off the edge of the data, and
   * always solid far below so it can never fall out of the world.
   */
  const heightmapWorld =
    (heights: ReadonlyArray<number>): IsBlockSolid =>
    (bx, by, bz) => {
      const index = (((bx * 7 + bz * 13) % heights.length) + heights.length) % heights.length
      return by <= heights[index]!
    }

  it.effect('PROPERTY: a body walking over broken terrain never ends a step inside a block', () =>
    Effect.sync(() => {
      // The invariant is INDUCTIVE — the resolver maintains "not penetrating",
      // it does not establish it (see domain/resolve.ts on the precondition) —
      // so the body starts in the air and every step is checked, not just the
      // last one.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.array(FastCheck.integer({ min: 60, max: 64 }), { minLength: 3, maxLength: 8 }),
          FastCheck.double({ min: -6, max: 6, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -6, max: 6, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          (heights, vx, vz, rawDelta) => {
            const options = withWorld(heightmapWorld(heights))
            const delta = clampDeltaTime(rawDelta)
            let body: Body = { kind: 'dynamic', x: 0.5, y: CentreY(70), z: 0.5, vx, vy: 0, vz }

            for (let frame = 0; frame < 60; frame += 1) {
              body = stepBody(body, delta, options).body
              if (penetratesSomething(body, options)) {
                return false
              }
            }
            return true
          },
        ),
        { numRuns: 200 },
      )
    }),
  )

  it.effect('PROPERTY: a body dropped from any height lands on the floor and never below it', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: 0.01, max: 20, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          (dropHeight, rawDelta) => {
            const options = withWorld(groundUpTo(0))
            const delta = clampDeltaTime(rawDelta)
            let body = standingOn(0, { y: CentreY(restingCentre(0) + dropHeight) })

            // Long enough to fall 20 blocks even at the smallest legal delta.
            for (let frame = 0; frame < 2500; frame += 1) {
              body = stepBody(body, delta, options).body
              if (body.y < restingCentre(0) - CONTACT_EPSILON) {
                return false
              }
            }
            return body.y === restingCentre(0)
          },
        ),
        { numRuns: 60 },
      )
    }),
  )

  it.effect('TUNNELLING: a body arriving at terminal velocity on the largest legal step is still caught', () =>
    Effect.sync(() => {
      // The worst case the delta cap permits: |TERMINAL_VELOCITY_Y| * 0.05 =
      // 1.6 blocks in one step, against a body 1.8 tall. The floor's top face
      // ends up inside the box, which is the whole reason those two numbers are
      // tied together (design-notes P-5).
      const options = withWorld(groundUpTo(63))
      const dropped = standingOn(63, {
        y: CentreY(restingCentre(63) + maxFallPerStep(MAX_DELTA_SECS) - 0.1),
        vy: TERMINAL_VELOCITY_Y,
      })

      const stepped = stepBody(dropped, clampDeltaTime(MAX_DELTA_SECS), options)

      expect(stepped.body.y).toBe(restingCentre(63))
      expect(stepped.body.vy).toBe(0)
      expect(stepped.isGrounded).toBe(true)
    }),
  )

  it.effect('the horizontal speed that breaks discrete resolution is far above anything the game moves at', () =>
    Effect.sync(() => {
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
    }),
  )
})

// ---------------------------------------------------------------------------
// ENERGY — plan.md §3.4
// ---------------------------------------------------------------------------

describe('energy', () => {
  it.effect('PROPERTY: a step never increases a body’s energy', () =>
    Effect.sync(() => {
      // Kinetic plus potential, per unit mass. Every path through the resolver
      // either zeroes a velocity component or moves the body back the way it
      // came, and the Y phase can only lift a body by as far as it just fell —
      // so the resolved height is never above the height the step started at.
      // A resolver that pushed out by penetration depth plus a safety margin,
      // or that snapped to the nearest surface either way, would fail this.
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: 64, max: 80, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -8, max: 8, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -20, max: 20, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -8, max: 8, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          (y, vx, vy, vz, rawDelta) => {
            const options = withWorld((bx, by, bz) => by <= 63 || (by <= 70 && bx === 2 && bz === 0))
            const delta = clampDeltaTime(rawDelta)
            let body: Body = { kind: 'dynamic', x: 0.5, y: CentreY(y), z: 0.5, vx, vy, vz }

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
    }),
  )

  it.effect('a bouncing-height regression: a body dropped repeatedly never ends up higher than it started', () =>
    Effect.sync(() => {
      const options = withWorld(groundUpTo(63))
      const start = standingOn(63, { y: CentreY(restingCentre(63) + 10) })
      let body = start

      for (let frame = 0; frame < 500; frame += 1) {
        body = stepBody(body, DT, options).body
        expect(body.y).toBeLessThanOrEqual(start.y)
      }
      expect(body.y).toBe(restingCentre(63))
    }),
  )

  it.effect('stepping up is the one path that adds energy — which is why the height is injected', () =>
    Effect.sync(() => {
      // Honest exception, stated rather than hidden. A step-up is a lift: the
      // body gains `g * stepHeight` of potential energy out of nothing, because
      // it is a gameplay affordance and not a collision response. It is opt-in
      // and defaults to zero for exactly this reason (docs/design-notes.md P-9).
      const isSlab = (bx: number, by: number): boolean => bx === 1 && by === 1
      const options = withWorld((bx, by) => by === 0 || isSlab(bx, by), {
        blockShapeAt: (bx, by) => (isSlab(bx, by) ? SLAB_SHAPE : null),
        stepHeight: 0.6,
      })
      const walking = standingOn(0, { x: 0.85, vx: REFERENCE_TOP_SPEED })

      const stepped = stepBody(walking, DT, options)

      expect(energyOf(stepped.body)).toBeGreaterThan(energyOf(walking))
      // And with no step height it does not.
      const withoutStepUp = stepBody(walking, DT, { ...options, stepHeight: 0 })
      expect(energyOf(withoutStepUp.body)).toBeLessThanOrEqual(energyOf(walking))
    }),
  )
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

  it.effect('resolving the same world twice gives the same answer', () =>
    Effect.sync(() => {
      expect(resolveWorld(crowd, DT, world)).toStrictEqual(resolveWorld(crowd, DT, world))
      expect(stepWorld(crowd, DT, world)).toStrictEqual(stepWorld(crowd, DT, world))
    }),
  )

  it.effect('is order-independent: bodies collide with blocks, never with each other', () =>
    Effect.sync(() => {
      // The same claim test/integrate.test.ts makes about integration, extended
      // to resolution. It holds for a structural reason rather than a numerical
      // one — `resolveWorld` is a map — and the test is here so that adding
      // entity-entity collision has to break something visible.
      const reversed = resolveWorld([...crowd].reverse(), DT, world)
      expect([...reversed].reverse()).toStrictEqual(resolveWorld(crowd, DT, world))

      const steppedReversed = stepWorld([...crowd].reverse(), DT, world)
      expect([...steppedReversed].reverse()).toStrictEqual(stepWorld(crowd, DT, world))
    }),
  )

  it.effect('PROPERTY: the answer does not depend on where a body sits in the array', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.shuffledSubarray([0, 1, 2, 3, 4], { minLength: 5 }), (order) => {
          const permuted = order.map((index) => crowd[index]!)
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
            const alone = resolveWorld([crowd[index]!], DT, world)[0]!
            const steppedAlone = stepWorld([crowd[index]!], DT, world)[0]!
            return (
              JSON.stringify(resolvedTogether[position]) === JSON.stringify(alone) &&
              JSON.stringify(steppedTogether[position]) === JSON.stringify(steppedAlone)
            )
          })
        }),
        { numRuns: 100 },
      )
    }),
  )

  it.effect('never moves a static or kinematic body, but still answers whether it is grounded', () =>
    Effect.sync(() => {
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
    }),
  )
})

// ---------------------------------------------------------------------------
// THE WORLD IS A CALLBACK — physics-no-block-id-name-checks (P-8)
// ---------------------------------------------------------------------------

describe('solidity is injected, never derived from a block id', () => {
  it.effect('only asks about cells the body could touch', () =>
    Effect.sync(() => {
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
    }),
  )

  it.effect('a block shape overrides the unit cube, and null defers to the solidity predicate', () =>
    Effect.sync(() => {
      // The reference's composition (aabb-collision.ts:54-61): the shape
      // function speaks for the few blocks that are not cubes and says nothing
      // about the rest. Standing on a slab therefore rests at y+0.5, and the
      // full blocks around it still work.
      const options = withWorld(groundUpTo(63), {
        blockShapeAt: (bx, by) => (by === 63 && bx === 0 ? SLAB_SHAPE : null),
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
    }),
  )

  it.effect('the same geometry with a different predicate gives a different answer, and no ids are involved', () =>
    Effect.sync(() => {
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
    }),
  )
})
