/**
 * The AABB collision resolver. This is the body of the repository.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT SITS: after the integrator, never before (P-3)
 * ---------------------------------------------------------------------------
 *
 * `integrateBody` moves a body; this puts it back where the world allows it to
 * be, and the ground clamp — `y = floorTop + halfHeight`, the reference's
 * `packages/game/domain/aabb-collision.ts:281-285` — lives INSIDE it. Run them
 * the other way round and gravity is applied after the clamp, so every body
 * hovers one frame's fall above the floor, permanently. `stepBody` below exists
 * so that the order is a fact about the code rather than a convention someone
 * has to remember, the same way `clampDeltaTime` is the only sanctioned way to
 * make a delta.
 *
 * ---------------------------------------------------------------------------
 * AXIS ORDER: Y, then X, then Z
 * ---------------------------------------------------------------------------
 *
 * The reference says the same in its first two lines
 * (`aabb-collision.ts:1-3`: "Y first -> X -> Z"), and keeps it with one test
 * (`packages/game/test/aabb-collision-edge-cases.test.ts:220`, "player falling
 * onto a ledge does not embed sideways"). Two things break if X runs first, and
 * both are things a player would report as a bug. They were MEASURED, by
 * running the horizontal phases against the pre-Y box and seeing which tests
 * went red — which is also how the third candidate was struck off:
 *
 * 1. WALKING CATCHES ON EVERY BLOCK SEAM. This is the one that would get
 *    reported first and diagnosed last. A body standing on flat ground is not
 *    resting on it at the moment the resolver runs: the integrator has just
 *    sunk it by one frame's fall, ~3.9 mm at 50 Hz. With X first, the floor
 *    block AHEAD of the body overlaps it by those 3.9 mm, the horizontal phase
 *    reads that as a wall, and the body is clamped to `blockMinX - halfWidth`.
 *    It can never cross x = 1. With Y first the body is lifted out of the floor
 *    before the horizontal phase looks, the overlap is back inside the contact
 *    skin, and it walks.
 * 2. STEP-UP STOPS WORKING ENTIRELY. Stepping onto a slab is the Y phase
 *    lifting the body onto the slab's top face; the horizontal phase then finds
 *    nothing in the way because the body is above it. Resolve X first and the
 *    slab is a wall, so the body stops dead against a half-block. The reference
 *    needs a whole second horizontal pass (`aabb-collision.ts:303-318`) to
 *    recover a case this ordering handles for free.
 *
 * NOT ON THAT LIST, THOUGH IT LOOKS LIKE IT SHOULD BE: falling onto a ledge and
 * embedding sideways, which is the symptom the reference's own ordering test
 * names. Measured here, that case survives an X-first resolver, because the
 * face-span guard in `clampAxis` catches it first — the ledge's near face is
 * behind the body, so the horizontal phase declines it whatever order it runs
 * in. Two mechanisms overlap on that one scenario. The reference's test is
 * carried across anyway (test/resolve.test.ts) because it pins the BEHAVIOUR,
 * which is worth keeping; it is just not evidence for this ordering.
 *
 * Z after X is the arbitrary half of the decision: the two are symmetric, and
 * the only thing that matters is that the second one runs against the position
 * the first one corrected, which is why `boxAfterX` is rebuilt below.
 *
 * ---------------------------------------------------------------------------
 * DISCRETE, NOT SWEPT — and the exact speed at which that fails
 * ---------------------------------------------------------------------------
 *
 * This resolver looks only at where the body ENDED UP. It does not sweep the
 * path it took, even though `domain/dda.ts` shows this repository can. That is
 * a deliberate choice and it is the one the rest of the repository is already
 * built on: `design-notes.md` P-5 justifies the 0.05 s delta cap by "the
 * resolver only catches a floor that lands inside the body's box after a step",
 * and `TERMINAL_VELOCITY_Y = -32` is derived from it. A swept resolver would
 * make that argument no longer the tightest description of the guard, so the
 * cap's justification would quietly become folklore.
 *
 * The trade has an exact price, so here it is. Discrete resolution misses a
 * block when the body's displacement in one step carries it clean past:
 *
 *     tunnels when  speed * maxDeltaSecs  >  blockThickness + 2 * halfExtent
 *
 * `maxSpeedWithoutTunnelling` below is that inequality, named. For the player
 * (halfWidth 0.3) against a one-block wall at the 0.05 s cap it is 32 m/s. The
 * reference's fastest horizontal speed is a sprint jump: 5.612 m/s times the
 * 1.2 sprint-jump multiplier, so 6.73 m/s
 * (`packages/entity/application/movement-service.ts:25-32`). The game runs at
 * under a quarter of the speed that breaks this, and the test asserts the
 * inequality rather than either number. Vertically the guard is stricter and
 * already tested: a fall of more than one body height would put the floor's top
 * face above the body's head, and `maxFallPerStep(MAX_DELTA_SECS) = 1.6` is
 * below the 1.8 body height.
 *
 * The remaining cost of discrete is an ambiguity it cannot resolve, and the
 * reference has it too: a body moving fast DOWNWARD and sideways into a wall
 * may end the step below that wall's top face, at which point "I fell onto it"
 * and "I ran into it" are the same state and it is treated as a floor. The
 * reference approximates the same rule with two tuned constants (MAX_STEP_UP
 * 0.6 and FALL_VELOCITY_THRESHOLD 8, `aabb-collision.ts:20-33`). This
 * resolver replaces both with the step's ACTUAL displacement, which is exact
 * and needs no tuning — see the Y phase.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS A FLOOR: the step's own displacement, not a tuned constant
 * ---------------------------------------------------------------------------
 *
 * A block whose top face is above the body's feet is a floor only if the body
 * could have got there by falling this step. That distance is `-vy * dt`
 * EXACTLY, not approximately: semi-implicit Euler moves the body by the NEW
 * velocity (P-4, `integrate.ts`), and the new velocity is what the resolver is
 * handed. Explicit Euler would have moved it by the OLD velocity, which the
 * resolver never sees — so this exactness is a second, quieter reason the
 * integrator's two lines cannot be swapped.
 *
 * Without such a test every wall is climbable: walk into a full block and its
 * top face, 1.0 above the feet, is the highest "floor" overlapping the body, so
 * the body is teleported on top of it. The reference explains this at
 * `aabb-collision.ts:20-25` and solves it with MAX_STEP_UP.
 *
 * `stepHeight` is the same idea as MAX_STEP_UP but INJECTED and defaulting to
 * zero, because 0.6 is a gameplay value and `docs/responsibility.md` §3 puts
 * gameplay values in mc-sim and the mechanism here. It is also the only path in
 * this file that can ADD energy to a body — stepping up is a free lift — which
 * is the other reason it is opt-in: at the default of 0 the resolver is
 * provably energy non-increasing, and the property test says so.
 *
 * ---------------------------------------------------------------------------
 * THE WORLD IS A CALLBACK
 * ---------------------------------------------------------------------------
 *
 * `isBlockSolid` is injected, exactly as mc-meshing injects `transparentBlockIds`
 * (its `docs/responsibility.md` §3.2). mc-physics never learns a block id. The
 * reference did the opposite and shipped the bug: a hand-written
 * `PASSABLE_BLOCK_IDS` denylist with leaves wrongly in it, so players fell
 * through tree canopies (`packages/game/domain/block-collision-predicates.ts:16-42`).
 * When mc-kernel publishes its capability flags, the repoint is a one-line
 * change in mc-sim and nothing here moves.
 */
import {
  CONTACT_EPSILON,
  CentreY,
  FULL_BLOCK_SHAPE,
  blockAABB,
  collidesWith,
  entityAABB,
  isRestingOn,
  type AABB,
  type HalfHeight,
} from './coordinates'
import type { DeltaTimeSecs } from './delta-time'
import { GRAVITY_Y, integrateBody, type Body } from './integrate'

/**
 * "Does this cell stop a body?" Asked once per candidate cell.
 *
 * Structurally identical to `IsTargetable` in domain/dda.ts and deliberately
 * NOT the same declaration: what you can aim at and what stops you are
 * different questions with different answers (water is targetable and not
 * solid; an unloaded chunk reads as solid for mobs and as air for the player —
 * `docs/responsibility.md` §3.3). TypeScript cannot keep them apart, so this is
 * documentation rather than enforcement; saying so is cheaper than a name that
 * implies a guarantee it does not have.
 */
export type IsBlockSolid = (bx: number, by: number, bz: number) => boolean

/**
 * The shape a block occupies within its own cell, or `null` for "no opinion".
 *
 * Coordinates are cell-relative, so `FULL_BLOCK_SHAPE` is the unit cube and
 * `SLAB_SHAPE` is its bottom half. `null` falls through to `isBlockSolid`,
 * which is the reference's composition (`aabb-collision.ts:54-61`): the shape
 * function knows about the few blocks that are not cubes and defers on the
 * rest.
 */
export type BlockShapeAt = (bx: number, by: number, bz: number) => AABB | null

export type ResolveOptions = {
  /** Half-extent on X and Z. The body is a box, not a capsule. */
  readonly halfWidth: number
  readonly halfHeight: HalfHeight
  readonly isBlockSolid: IsBlockSolid
  readonly blockShapeAt?: BlockShapeAt
  /**
   * How far above the feet a block's top face still counts as a floor to be
   * lifted onto. Zero — no step-up — unless the caller asks otherwise. See the
   * file header on why the value belongs to mc-sim.
   */
  readonly stepHeight?: number
}

export type Resolution = {
  readonly body: Body
  /**
   * Is the body standing on something, AFTER resolution?
   *
   * Asked of the world rather than remembered from the Y phase, which is where
   * the reference gets it (`isGrounded = true` beside the ground clamp). The
   * difference shows when the resolver runs twice: the reference's flag is true
   * the first time and false the second, because the second run finds no
   * penetration left to clamp. This one is a fact about where the body is, so
   * it is stable, and `resolveBody` is a fixed point — which is the property
   * that rules out resting jitter.
   */
  readonly isGrounded: boolean
}

const shapeAt = (options: ResolveOptions, bx: number, by: number, bz: number): AABB | null =>
  options.blockShapeAt?.(bx, by, bz) ?? (options.isBlockSolid(bx, by, bz) ? FULL_BLOCK_SHAPE : null)

const boxAt = (options: ResolveOptions, x: number, y: number, z: number): AABB =>
  entityAABB(x, CentreY(y), z, options.halfWidth, options.halfHeight)

/**
 * Every solid block box overlapping `box` beyond the contact skin.
 *
 * Collected into an array rather than folded in place so that each phase below
 * is a `reduce` over a set: `min` and `max` do not care what order they see
 * their arguments in, which is how the resolver gets to be scan-order
 * independent by construction rather than by inspection.
 *
 * This allocates, and the reference does not (it fuses the scan and the fold,
 * and mutates its output arguments). `integrate.ts` makes the same trade for
 * the same reason: the pure version is the definition, and an in-place variant
 * gets written when there is a benchmark to justify it and this to test against.
 */
const collidingBlocks = (options: ResolveOptions, box: AABB): ReadonlyArray<AABB> => {
  const found: Array<AABB> = []
  const bxMax = Math.floor(box.maxX)
  const byMax = Math.floor(box.maxY)
  const bzMax = Math.floor(box.maxZ)

  for (let bx = Math.floor(box.minX); bx <= bxMax; bx += 1) {
    for (let by = Math.floor(box.minY); by <= byMax; by += 1) {
      for (let bz = Math.floor(box.minZ); bz <= bzMax; bz += 1) {
        const shape = shapeAt(options, bx, by, bz)
        if (shape === null) {
          continue
        }
        const blockBox = blockAABB(bx, by, bz, shape)
        if (collidesWith(box, blockBox)) {
          found.push(blockBox)
        }
      }
    }
  }

  return found
}

type AxisState = {
  readonly position: number
  readonly velocity: number
}

/**
 * Push a body out along one horizontal axis, back through the face it entered.
 *
 * Shared by X and Z. The reference writes these two out separately, which is
 * ~100 lines of near-identical code and four places to fix a sign in.
 *
 * ONLY FACES INSIDE THE BODY COUNT, which is the reference's `face >= x - halfW`
 * test (`aabb-collision.ts:114` and `:141`) and is doing more work than it
 * looks like. Walk diagonally into an inside corner and the block across from
 * the body overlaps it on BOTH horizontal axes — deeply on one, shallowly on
 * the other. Its near face on the deep axis is already behind the body, so
 * resolving along that axis would shove the body a whole block backwards
 * (measured: x = 0.93 to x = -0.3). A face behind the body means the body did
 * not come in through it, so the overlap belongs to the other axis's phase,
 * which runs next against the position this one corrected and resolves it by
 * the shallow 0.23 instead.
 *
 * Among the faces that do count, the furthest back wins, so the result
 * separates the body from all of them at once. A body with no velocity on this
 * axis is left alone: it cannot have entered anything along an axis it did not
 * move on.
 */
const clampAxis = (
  state: AxisState,
  bodyMin: number,
  bodyMax: number,
  halfExtent: number,
  blocks: ReadonlyArray<AABB>,
  nearFace: (block: AABB) => number,
  farFace: (block: AABB) => number,
): AxisState => {
  if (state.velocity > 0) {
    const face = blocks.reduce(
      (nearest, block) => (nearFace(block) >= bodyMin ? Math.min(nearest, nearFace(block)) : nearest),
      Number.POSITIVE_INFINITY,
    )
    return face < Number.POSITIVE_INFINITY ? { position: face - halfExtent, velocity: 0 } : state
  }
  if (state.velocity < 0) {
    const face = blocks.reduce(
      (nearest, block) => (farFace(block) <= bodyMax ? Math.max(nearest, farFace(block)) : nearest),
      Number.NEGATIVE_INFINITY,
    )
    return face > Number.NEGATIVE_INFINITY ? { position: face + halfExtent, velocity: 0 } : state
  }
  return state
}

/**
 * The Y phase, including the ground clamp.
 *
 * Falling: the highest floor face within reach of the feet, where "within
 * reach" is this step's own fall plus the injected step height. Rising: the
 * lowest ceiling face within reach of the head. The two cannot both apply,
 * because a body cannot be moving up and down in the same step — the reference
 * applies both and lets the ceiling win, which puts a body in a gap narrower
 * than itself at the ceiling rather than at the floor for no stated reason.
 *
 * `y = floorTop + halfHeight` is the ground clamp, and it is exact: no epsilon
 * is added here. The residual of that addition and the `- halfHeight` a caller
 * does to get back to the feet is a few ulp either way, which is exactly the
 * error `CONTACT_EPSILON` was sized for (P-6) and exactly the state
 * test/coordinates.test.ts pins.
 */
const resolveVertical = (
  options: ResolveOptions,
  box: AABB,
  state: AxisState,
  deltaTime: DeltaTimeSecs,
): AxisState => {
  const blocks = collidingBlocks(options, box)
  if (blocks.length === 0) {
    return state
  }

  if (state.velocity <= 0) {
    const reach = -state.velocity * deltaTime + (options.stepHeight ?? 0) + CONTACT_EPSILON
    const floorTop = blocks.reduce(
      (highest, block) => (block.maxY - box.minY <= reach ? Math.max(highest, block.maxY) : highest),
      Number.NEGATIVE_INFINITY,
    )
    return floorTop > Number.NEGATIVE_INFINITY
      ? { position: floorTop + options.halfHeight, velocity: 0 }
      : state
  }

  const reach = state.velocity * deltaTime + CONTACT_EPSILON
  const ceiling = blocks.reduce(
    (lowest, block) => (box.maxY - block.minY <= reach ? Math.min(lowest, block.minY) : lowest),
    Number.POSITIVE_INFINITY,
  )
  return ceiling < Number.POSITIVE_INFINITY ? { position: ceiling - options.halfHeight, velocity: 0 } : state
}

/**
 * Is anything holding this body up?
 *
 * Only two cell layers can hold a top face at the feet: the cell the feet are
 * in (a slab, whose top is partway up its own cell) and the one below it (a
 * full block, whose top is that cell's ceiling). A block two cells down cannot
 * reach, whatever its shape, because shapes live inside the unit cube.
 */
const isSupported = (options: ResolveOptions, box: AABB): boolean => {
  const feetCell = Math.floor(box.minY)
  const bxMax = Math.floor(box.maxX)
  const bzMax = Math.floor(box.maxZ)

  for (let bx = Math.floor(box.minX); bx <= bxMax; bx += 1) {
    for (let bz = Math.floor(box.minZ); bz <= bzMax; bz += 1) {
      for (let by = feetCell - 1; by <= feetCell; by += 1) {
        const shape = shapeAt(options, bx, by, bz)
        if (shape !== null && isRestingOn(box, blockAABB(bx, by, bz, shape))) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Put one body back where the world allows it to be.
 *
 * `deltaTime` must be the delta the body was integrated with: the resolver
 * reconstructs the step's displacement from it to decide what could have been
 * landed on. Passing a different one is not a rounding error, it is a different
 * question being answered.
 *
 * PRECONDITION, stated because it is doing real work: the body was not
 * penetrating anything BEFORE the step. The resolver maintains that invariant,
 * it does not establish it — a body spawned inside terrain, or a block placed
 * inside a player, is an unstick problem and a different function. The
 * reference conflates the two with an `overCenter` special case
 * (`aabb-collision.ts:264-272`) that teleports any body onto the highest block
 * beneath its centre, whatever it is doing.
 *
 * `static` and `kinematic` bodies are never moved — their motion is authored
 * elsewhere, and `integrateBody` leaves them alone for the same reason — but
 * they are still asked whether they are grounded, because that is a question
 * about the world and not about this step.
 */
export const resolveBody = (body: Body, deltaTime: DeltaTimeSecs, options: ResolveOptions): Resolution => {
  if (body.kind !== 'dynamic') {
    return { body, isGrounded: isSupported(options, boxAt(options, body.x, body.y, body.z)) }
  }

  const vertical = resolveVertical(
    options,
    boxAt(options, body.x, body.y, body.z),
    { position: body.y, velocity: body.vy },
    deltaTime,
  )

  const boxAfterY = boxAt(options, body.x, vertical.position, body.z)
  const alongX = clampAxis(
    { position: body.x, velocity: body.vx },
    boxAfterY.minX,
    boxAfterY.maxX,
    options.halfWidth,
    collidingBlocks(options, boxAfterY),
    (block) => block.minX,
    (block) => block.maxX,
  )

  const boxAfterX = boxAt(options, alongX.position, vertical.position, body.z)
  const alongZ = clampAxis(
    { position: body.z, velocity: body.vz },
    boxAfterX.minZ,
    boxAfterX.maxZ,
    options.halfWidth,
    collidingBlocks(options, boxAfterX),
    (block) => block.minZ,
    (block) => block.maxZ,
  )

  const resolved: Body = {
    kind: 'dynamic',
    x: alongX.position,
    y: vertical.position,
    z: alongZ.position,
    vx: alongX.velocity,
    vy: vertical.velocity,
    vz: alongZ.velocity,
  }

  return {
    body: resolved,
    isGrounded: isSupported(options, boxAt(options, resolved.x, resolved.y, resolved.z)),
  }
}

/**
 * Resolve a whole world. Order-independent: bodies collide with BLOCKS, never
 * with each other, so this is a map and nothing more.
 *
 * Entity-entity collision would change that — it is the point at which a
 * resolver stops being order-independent unless it is written as a solver over
 * all pairs — and it is not in this repository's responsibilities.
 */
export const resolveWorld = (
  bodies: ReadonlyArray<Body>,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
): ReadonlyArray<Resolution> => bodies.map((body) => resolveBody(body, deltaTime, options))

/**
 * One step: integrate, THEN resolve. plan.md §3.4's `step(state, world, dt)`.
 *
 * The only reason this exists is the ordering (P-3). Nothing stops a caller
 * from writing the two calls out by hand, and the resolver cannot detect that
 * they were written the wrong way round — it would just clamp a body that had
 * not moved yet, and then gravity would lift it off the floor on the next line.
 * Having a name for the correct composition is what makes the wrong one visible
 * in a diff.
 */
export const stepBody = (
  body: Body,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
  gravityY: number = GRAVITY_Y,
): Resolution => resolveBody(integrateBody(body, deltaTime, gravityY), deltaTime, options)

export const stepWorld = (
  bodies: ReadonlyArray<Body>,
  deltaTime: DeltaTimeSecs,
  options: ResolveOptions,
  gravityY: number = GRAVITY_Y,
): ReadonlyArray<Resolution> => bodies.map((body) => stepBody(body, deltaTime, options, gravityY))

/**
 * The speed above which discrete resolution starts to miss things.
 *
 * A body tunnels when one step carries it clean past an obstacle: its
 * displacement exceeds the obstacle's thickness plus the body's own extent on
 * both sides. Exposed so the guard can be asserted as an inequality between
 * named quantities — the same shape as `maxFallPerStep` in integrate.ts, and
 * for the same reason: tuning either the delta cap or the body size then fails
 * a test instead of silently opening a hole.
 */
export const maxSpeedWithoutTunnelling = (halfExtent: number, blockThickness: number, maxDeltaSecs: number): number =>
  (blockThickness + 2 * halfExtent) / maxDeltaSecs
