/**
 * The Y convention, made impossible to get wrong.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE EXISTS BECAUSE OF ONE BUG CLASS (plan.md §3.4)
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.4 states it flatly: every "things float" bug in the reference
 * implementation was, without exception, a mismatch between FOOT-ORIGIN Y and
 * BODY-CENTRE Y. Both are plain `number` there, so the compiler cannot tell
 * them apart and neither can a reviewer.
 *
 * The reference stores BODY-CENTRE Y everywhere in the physics path
 * (`packages/game/domain/aabb-collision.ts:232-237`:
 * `const feetY = y - halfH`), and every consumer that wants feet converts by
 * hand. Six separate places do that conversion, each written out again:
 *
 *   game-state-update-orchestration.ts:148   currentPos.y - PLAYER_HALF_HEIGHT - 0.05
 *   game-state-update-orchestration.ts:231   y: physPos.y - PLAYER_HALF_HEIGHT
 *   game-state-update-orchestration.ts:277   y: physPos.y - PLAYER_HALF_HEIGHT
 *   player-physics.ts:176                    collidedPos.y - PLAYER_HALF_HEIGHT
 *   player-physics.ts:219                    collidedPos.y - PLAYER_HALF_HEIGHT
 *   entity-update-stage.pressure-plate.ts:36 pos.y - MOB_HALF_HEIGHT
 *
 * and the reference carries a comment at
 * `game-state-update-orchestration.ts:97-103` documenting a shipped bug caused
 * by exactly this — a vehicle dismounting spuriously because sampling at the
 * true feet put the probe on a cell boundary.
 *
 * Branding the two makes `footY - halfHeight` a type error instead of a
 * floating player. The conversion still exists, but it exists ONCE, here, with
 * a name. See docs/design-notes.md, regression `physics-y-convention-is-typed`.
 *
 * ---------------------------------------------------------------------------
 * Block occupancy
 * ---------------------------------------------------------------------------
 *
 * A block at integer cell `y` occupies the half-open interval [y, y+1]. Its top
 * surface is therefore at y+1, which is why spawn and every standing plane in
 * the reference is `surfaceY + 1` and not `surfaceY`
 * (`packages/app/application/main/spawn-selection-search.ts:206`:
 * `y: surfaceY + 1 + PLAYER_HALF_HEIGHT` — note it adds BOTH: one to get to the
 * block's top face, and the half-height to get from the feet to the centre).
 * `FULL_BLOCK_SHAPE` below is the reference's `FULL_BLOCK_COLLISION_SHAPE`
 * (`packages/game/domain/aabb-collision-shapes.ts:16-23`).
 */
import { COLLISION_SHAPE_AABBS, FULL_BLOCK_SHAPE } from './shape-data'
import { Brand } from 'effect'
import type { CollisionShape } from '@nerima-games/mc-kernel'

/** Y of the plane an entity's feet rest on. What spawn logic and game rules speak. */
export type FootY = number & Brand.Brand<'FootY'>

export const FootY = Brand.nominal<FootY>()

/** Y of the centre of an entity's AABB. What the integrator and resolver speak. */
export type CentreY = number & Brand.Brand<'CentreY'>

export const CentreY = Brand.nominal<CentreY>()

/** Vertical half-extent of an entity's AABB. Never negative. */
export type HalfHeight = number & Brand.Brand<'HalfHeight'>

export const HalfHeight = Brand.refined<HalfHeight>(
  (value) => Number.isFinite(value) && value > 0,
  (value) => Brand.error(`HalfHeight must be a positive finite number, received ${value}`),
)

/** THE conversion, foot -> centre. The only one in the repository. */
export const centreOfFoot = (foot: FootY, halfHeight: HalfHeight): CentreY => CentreY(foot + halfHeight)

/** THE conversion, centre -> foot. The only one in the repository. */
export const footOfCentre = (centre: CentreY, halfHeight: HalfHeight): FootY => FootY(centre - halfHeight)

/**
 * The standing plane on top of the block at integer cell `surfaceY`.
 *
 * `surfaceY + 1`, because a block occupies [y, y+1]. Named rather than inlined
 * so that the off-by-one lives in one place with a test on it.
 */
export const standingPlaneAbove = (surfaceY: number): FootY => FootY(surfaceY + 1)

/** Reference player half-extents (`packages/core/domain/constants.ts:22-24`). */
export const PLAYER_HALF_WIDTH = 0.3
const PLAYER_HALF_HEIGHT_METRES = 0.9
export const PLAYER_HALF_HEIGHT: HalfHeight = HalfHeight(PLAYER_HALF_HEIGHT_METRES)

/** Structurally identical to this package's old `Vec3`/`vec3`; kernel owns the vocabulary now. */
export type { Position } from '@nerima-games/mc-kernel'
export { position } from '@nerima-games/mc-kernel'

/** An axis-aligned bounding box. `min <= max` componentwise, by construction. */
export type AABB = {
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
}

/** One or more collision boxes authored in a block's local unit cell. */
export type BlockShape = AABB | ReadonlyArray<AABB>

export const aabbsOfBlockShape = (shape: BlockShape): ReadonlyArray<AABB> => {
  if ('minX' in shape) {
    return [shape]
  }
  return shape
}

/**
 * The AABB of an entity whose CENTRE is at `centre`.
 *
 * Takes a `CentreY` rather than a `number`, so the caller cannot pass a foot Y
 * by accident and end up with a box sunk half a body into the ground — which is
 * the "things float" bug seen from the other side.
 */
export const entityAABB = (
  x: number,
  centreY: CentreY,
  z: number,
  halfWidth: number,
  halfHeight: HalfHeight,
): AABB => ({
  maxX: x + halfWidth,
  maxY: centreY + halfHeight,
  maxZ: z + halfWidth,
  minX: x - halfWidth,
  minY: centreY - halfHeight,
  minZ: z - halfWidth,
})

export const aabbOfCollisionShape = (shape: CollisionShape): AABB | null =>
  COLLISION_SHAPE_AABBS[shape]

/** The world-space AABB of the block at integer cell (bx, by, bz), given its shape. */
export const blockAABB = (bx: number, by: number, bz: number, shape: AABB = FULL_BLOCK_SHAPE): AABB => ({
  maxX: bx + shape.maxX,
  maxY: by + shape.maxY,
  maxZ: bz + shape.maxZ,
  minX: bx + shape.minX,
  minY: by + shape.minY,
  minZ: bz + shape.minZ,
})

/**
 * Overlap test. Touching faces do NOT overlap.
 *
 * Standing exactly on a surface — feet at y, block top at y — must not read as
 * a collision, or the resolver fights itself every frame and the entity
 * vibrates. Strict inequality is what makes resting stable.
 *
 * EXACT, and therefore float-fragile. See `CONTACT_EPSILON`.
 */
export const intersects = (a: AABB, b: AABB): boolean =>
  a.minX < b.maxX &&
  a.maxX > b.minX &&
  a.minY < b.maxY &&
  a.maxY > b.minY &&
  a.minZ < b.maxZ &&
  a.maxZ > b.minZ

/**
 * Overlap depth on the Y axis. Zero or negative means the boxes do not overlap.
 *
 * `intersects` answers whether; this answers how much, which is what a resolver
 * needs and what makes the epsilon below expressible as a test.
 */
export const penetrationY = (a: AABB, b: AABB): number =>
  Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY)

/**
 * ---------------------------------------------------------------------------
 * Penetration below this depth is floating-point noise, not contact.
 * ---------------------------------------------------------------------------
 *
 * `footOfCentre(centreOfFoot(foot, h), h)` is `(foot + h) - h`, which is NOT
 * exactly `foot` in IEEE-754. The property test in test/coordinates.ts found
 * the counterexample: `surfaceY = 1`, `halfHeight = 0.05`, so the foot is 2 and
 * the centre is 2.05 — but 2.05 is stored as 2.049999999999999822..., and
 * subtracting 0.05 gives 1.9999999999999998, two ulp BELOW the block top at 2.
 *
 * A strict `intersects` therefore reports a collision for an entity that is
 * standing exactly still on a floor. Left alone, the resolver would push it up
 * by 2e-16 every frame forever — the classic resting jitter.
 *
 * This is why every real collision resolver carries a contact skin. The
 * constant is named and exported rather than sprinkled inline so that the
 * resolver (not yet written) and its tests agree on one value, and so that the
 * reason survives.
 *
 * 1e-9 is roughly seven orders of magnitude above the observed error and seven
 * below any distance a player can perceive.
 */
export const CONTACT_EPSILON = 1e-9

/**
 * Overlap deep enough on EVERY axis to be a collision rather than contact.
 *
 * This is the predicate the resolver acts on: `intersects` decides whether the
 * boxes touch at all, this decides whether something must move. The difference
 * is exactly `CONTACT_EPSILON`, and it is load-bearing in a way that is easy to
 * miss — a body standing still on a floor overlaps it by ~2e-16 (see the
 * constant above), and if that counted as a collision the resolver would push
 * it up every frame forever, and the HORIZONTAL phase would read the next floor
 * block along as a wall and refuse to let the body walk across the seam between
 * two floor blocks. Both symptoms have the same cause and this one predicate
 * removes both.
 *
 * NOTE WHERE THE EPSILON IS. It is in the test for what counts as a collision.
 * It is NOT added to any position the resolver writes: `domain/resolve.ts`
 * lands a body at exactly `floorTop + halfHeight`, with no fudge. Nudging
 * positions instead would make the resting state depend on how many frames the
 * body has been resting, which is the bug this repository already has a test
 * for (test/coordinates.test.ts, `the documented counterexample`).
 */
export const collidesWith = (a: AABB, b: AABB): boolean =>
  Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > CONTACT_EPSILON &&
  Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > CONTACT_EPSILON &&
  Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > CONTACT_EPSILON

/**
 * Are the entity's FEET on top of this surface, within the contact skin?
 *
 * True when the boxes overlap horizontally and the body's underside is within
 * `CONTACT_EPSILON` of the surface's top face — above it or below it, because
 * `(foot + h) - h` lands on either side of the exact value and the resolver's
 * `floorTop + halfHeight` inherits the same rounding. This is what "grounded"
 * means, and `domain/resolve.ts` answers the grounded question by asking it of
 * the cells under the feet.
 *
 * CORRECTED. This predicate used to read `penetrationY(body, surface) <=
 * CONTACT_EPSILON`, which is one-sided: `penetrationY` goes NEGATIVE when the
 * boxes are apart, so a body in free fall five blocks above a floor satisfied
 * it, and so did a body pressing its head against a ceiling. Every existing
 * test still passes because they all place the body exactly on the surface,
 * where the two readings agree — the difference only shows up somewhere no test
 * had gone yet, which is precisely where a resolver has to go. See
 * docs/design-notes.md P-6.
 */
export const isRestingOn = (body: AABB, surface: AABB): boolean =>
  body.minX < surface.maxX &&
  body.maxX > surface.minX &&
  body.minZ < surface.maxZ &&
  body.maxZ > surface.minZ &&
  Math.abs(body.minY - surface.maxY) <= CONTACT_EPSILON
