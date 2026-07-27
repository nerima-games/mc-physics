/**
 * Integration, the delta clamp, and the tunnelling invariant that ties them.
 *
 * Regression names (docs/design-notes.md):
 *   physics-delta-clamp-is-exact
 *   physics-first-frame-delta
 *   physics-integrator-is-symplectic
 *   physics-terminal-velocity-cannot-tunnel
 *   physics-dda-skips-origin-cell
 *   physics-dda-respects-max-distance
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, FastCheck, Option } from 'effect'
import { PLAYER_HALF_HEIGHT, vec3 } from '../domain/coordinates'
import { voxelRaycast } from '../domain/dda'
import {
  DeltaTimeSecs,
  FIRST_FRAME_DELTA_SECS,
  MAX_DELTA_SECS,
  MIN_DELTA_SECS,
  clampDeltaTime,
  deltaTimeBetween,
  isClampedDelta,
} from '../domain/delta-time'
import { GRAVITY_Y, TERMINAL_VELOCITY_Y, integrate, integrateBody, maxFallPerStep, type Body } from '../domain/integrate'

const dynamicBody = (over: Partial<Body> = {}): Body => ({
  kind: 'dynamic',
  x: 0,
  y: 100,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  ...over,
})

describe('the deltaTime clamp', () => {
  it.effect('is exactly min(max(0.001, raw), 0.05)', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
          (raw) => clampDeltaTime(raw) === Math.min(Math.max(MIN_DELTA_SECS, raw), MAX_DELTA_SECS),
        ),
        { numRuns: 500 },
      )
    }),
  )

  it.effect('caps a backgrounded tab at 0.05s instead of teleporting everything through the floor', () =>
    Effect.sync(() => {
      expect(clampDeltaTime(30)).toBe(MAX_DELTA_SECS)
      expect(clampDeltaTime(Number.POSITIVE_INFINITY)).toBe(MAX_DELTA_SECS)
    }),
  )

  it.effect('floors a zero, negative or backwards-clock delta at 0.001s', () =>
    Effect.sync(() => {
      expect(clampDeltaTime(0)).toBe(MIN_DELTA_SECS)
      expect(clampDeltaTime(-5)).toBe(MIN_DELTA_SECS)
      expect(clampDeltaTime(Number.NEGATIVE_INFINITY)).toBe(MIN_DELTA_SECS)
    }),
  )

  it.effect('maps NaN to the first-frame delta rather than letting it poison every position', () =>
    Effect.sync(() => {
      expect(clampDeltaTime(Number.NaN)).toBe(FIRST_FRAME_DELTA_SECS)
    }),
  )

  it.effect('uses 0.016s for the first frame, where there is no previous timestamp to subtract', () =>
    Effect.sync(() => {
      expect(deltaTimeBetween(undefined, 12345)).toBe(FIRST_FRAME_DELTA_SECS)
      expect(deltaTimeBetween(10, 10.02)).toBeCloseTo(0.02, 12)
    }),
  )

  // REGRESSION: this brand is `Brand.Brand<'DeltaTimeSecs'>`, and a brand is
  // keyed by that STRING — so kernel's `DeltaTimeSecs`
  // (mc-kernel/domain/quantities.ts:37-42) and this one are the same type to
  // TypeScript no matter how differently they validate. This declaration used
  // to refine to [0.001, 0.05] while kernel refines to "finite, non-negative",
  // which meant a kernel-constructed `DeltaTimeSecs(30)` typechecked as an
  // argument to `integrateBody` while breaking the invariant its comment
  // claimed. The refinement is now kernel's, exactly.
  it.effect('REGRESSION: the brand is kernel’s refinement — finite and non-negative, zero included', () =>
    Effect.sync(() => {
      // A zero delta is LEGAL: kernel's note says a frame may be scheduled
      // twice inside one clock tick. Stages handle it; the brand does not
      // reject it.
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(FIRST_FRAME_DELTA_SECS)).toBe(FIRST_FRAME_DELTA_SECS)
      expect(DeltaTimeSecs(MAX_DELTA_SECS)).toBe(MAX_DELTA_SECS)
      // Out of the integrator's safe range, but a perfectly good quantity —
      // exactly what a backgrounded tab produces before anyone clamps it.
      expect(DeltaTimeSecs(30)).toBe(30)

      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  // The safety property the old refinement was reaching for, restated where it
  // is actually true: the CLAMP is the boundary, not the constructor.
  it.effect('REGRESSION: clampDeltaTime is the boundary — its output is always inside the safe range', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -1000, max: 1000, noNaN: false }),
          (raw) => isClampedDelta(clampDeltaTime(raw)),
        ),
        { numRuns: 500 },
      )

      expect(isClampedDelta(DeltaTimeSecs(30))).toBe(false)
      expect(isClampedDelta(DeltaTimeSecs(0))).toBe(false)
      expect(isClampedDelta(MIN_DELTA_SECS)).toBe(true)
      expect(isClampedDelta(MAX_DELTA_SECS)).toBe(true)
      expect(isClampedDelta(FIRST_FRAME_DELTA_SECS)).toBe(true)
    }),
  )
})

describe('semi-implicit Euler', () => {
  it.effect('updates velocity first and position from the NEW velocity', () =>
    Effect.sync(() => {
      // Explicit Euler would give y = 100 exactly (old velocity 0). Symplectic
      // gives y = 100 + (g*dt)*dt. The difference is the whole distinction, and
      // it is what stops a bouncing entity from gaining energy every step.
      const delta = clampDeltaTime(0.02)
      const stepped = integrateBody(dynamicBody(), delta)
      expect(stepped.vy).toBeCloseTo(GRAVITY_Y * delta, 12)
      expect(stepped.y).toBeCloseTo(100 + GRAVITY_Y * delta * delta, 12)
      expect(stepped.y).toBeLessThan(100)
    }),
  )

  it.effect('never lets a dynamic body fall faster than terminal velocity', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: MIN_DELTA_SECS, max: MAX_DELTA_SECS, noNaN: true, noDefaultInfinity: true }),
          FastCheck.integer({ min: 1, max: 400 }),
          (rawDelta, steps) => {
            const delta = clampDeltaTime(rawDelta)
            let body = dynamicBody()
            for (let step = 0; step < steps; step += 1) {
              body = integrateBody(body, delta)
              if (body.vy < TERMINAL_VELOCITY_Y) {
                return false
              }
            }
            return true
          },
        ),
        { numRuns: 100 },
      )
    }),
  )

  it.effect('TUNNELLING INVARIANT: one step at the delta cap never falls further than one body height', () =>
    Effect.sync(() => {
      // The AABB resolver can only catch a floor that ends up inside the body's
      // box. If this inequality ever breaks, fast falls pass through floors and
      // no test of the resolver itself would notice. Asserted between named
      // constants so that tuning either one fails here.
      const bodyHeight = 2 * Number(PLAYER_HALF_HEIGHT)
      expect(maxFallPerStep(MAX_DELTA_SECS)).toBeLessThanOrEqual(bodyHeight)
    }),
  )

  it.effect('leaves static and kinematic bodies completely alone', () =>
    Effect.sync(() => {
      const delta = clampDeltaTime(0.02)
      for (const kind of ['static', 'kinematic'] as const) {
        const body = dynamicBody({ kind, vy: -5 })
        expect(integrateBody(body, delta)).toStrictEqual(body)
      }
    }),
  )

  it.effect('is deterministic and order-independent across a world of bodies', () =>
    Effect.sync(() => {
      const delta = clampDeltaTime(0.02)
      const bodies: ReadonlyArray<Body> = [
        dynamicBody({ y: 10 }),
        dynamicBody({ kind: 'static', y: 20 }),
        dynamicBody({ y: 30, vx: 1 }),
      ]
      expect(integrate(bodies, delta)).toStrictEqual(integrate(bodies, delta))
      const reversed = integrate([...bodies].reverse(), delta)
      expect([...reversed].reverse()).toStrictEqual(integrate(bodies, delta))
    }),
  )

  it.effect('does not touch horizontal velocity: gravity acts on Y only', () =>
    Effect.sync(() => {
      const stepped = integrateBody(dynamicBody({ vx: 3, vz: -4 }), clampDeltaTime(0.02))
      expect(stepped.vx).toBe(3)
      expect(stepped.vz).toBe(-4)
    }),
  )
})

describe('voxel DDA', () => {
  const solidAt = (target: readonly [number, number, number]) => (bx: number, by: number, bz: number) =>
    bx === target[0] && by === target[1] && bz === target[2]

  it.effect('never returns the cell the ray starts in, so you cannot mine the block you are inside', () =>
    Effect.sync(() => {
      const hit = voxelRaycast(vec3(0.5, 0.5, 0.5), vec3(1, 0, 0), 8, solidAt([0, 0, 0]))
      expect(Option.isNone(hit)).toBe(true)
    }),
  )

  it.effect('finds the first targetable cell along the ray and reports the face it entered through', () =>
    Effect.sync(() => {
      const hit = voxelRaycast(vec3(0.5, 0.5, 0.5), vec3(1, 0, 0), 8, solidAt([3, 0, 0]))
      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) {
        expect([hit.value.bx, hit.value.by, hit.value.bz]).toStrictEqual([3, 0, 0])
        // Entered through the -X face, so the normal points back at the ray.
        expect(hit.value.normal).toStrictEqual({ x: -1, y: 0, z: 0 })
        expect(hit.value.distance).toBeCloseTo(2.5, 10)
        expect(hit.value.point.x).toBeCloseTo(3, 10)
      }
    }),
  )

  it.effect('respects maxDistance measured in blocks, because the direction is normalised', () =>
    Effect.sync(() => {
      // The reference does not normalise, so its maxDistance is in units of the
      // caller's vector. Here 4.9 blocks short and 5.1 blocks long is the whole
      // difference, whatever length the direction vector happens to have.
      const target = solidAt([5, 0, 0])
      for (const direction of [vec3(1, 0, 0), vec3(100, 0, 0)]) {
        expect(Option.isNone(voxelRaycast(vec3(0.5, 0.5, 0.5), direction, 4.4, target))).toBe(true)
        expect(Option.isSome(voxelRaycast(vec3(0.5, 0.5, 0.5), direction, 4.6, target))).toBe(true)
      }
    }),
  )

  it.effect('returns none for degenerate inputs instead of looping or throwing', () =>
    Effect.sync(() => {
      const anything = () => true
      expect(Option.isNone(voxelRaycast(vec3(0, 0, 0), vec3(0, 0, 0), 8, anything))).toBe(true)
      expect(Option.isNone(voxelRaycast(vec3(0, 0, 0), vec3(1, 0, 0), 0, anything))).toBe(true)
      expect(Option.isNone(voxelRaycast(vec3(0, 0, 0), vec3(1, 0, 0), -1, anything))).toBe(true)
      expect(Option.isNone(voxelRaycast(vec3(Number.NaN, 0, 0), vec3(1, 0, 0), 8, anything))).toBe(true)
      expect(Option.isNone(voxelRaycast(vec3(0, 0, 0), vec3(Number.NaN, 0, 0), 8, anything))).toBe(true)
    }),
  )

  it.effect('visits cells in strictly increasing distance order, never skipping one', () =>
    Effect.sync(() => {
      // A DDA that advances the wrong axis skips cells, and a skipped cell is a
      // block you can shoot through. Recording the visit order is the only way
      // to see that from outside.
      const visited: Array<string> = []
      voxelRaycast(vec3(0.5, 0.5, 0.5), vec3(1, 0, 0), 5, (bx, by, bz) => {
        visited.push(`${bx},${by},${bz}`)
        return false
      })
      expect(visited).toStrictEqual(['1,0,0', '2,0,0', '3,0,0', '4,0,0', '5,0,0'])
    }),
  )

  /**
   * The origin for every negative-direction case below.
   *
   * DELIBERATELY NOT THE CELL MIDPOINT. At 0.5 the two first-crossing formulas
   * `origin - cell` and `cell + 1 - origin` produce the SAME number, so a
   * negative arm that mistakenly uses the positive formula is invisible from
   * there — every cell is still visited, in order, at plausible distances. At
   * 0.75 the two disagree by half a cell and the mistake has somewhere to show.
   * This is the whole reason these tests exist, so it must not be tidied to 0.5.
   */
  const OFF_CENTRE = 0.75

  /**
   * The three negative axes, with the cell reached after `n` crossings from
   * `OFF_CENTRE`, the face the ray enters through, and the exact point on it.
   *
   * A negative step takes its first crossing distance from `origin - cell`
   * rather than from `cell + 1 - origin` (domain/dda.ts). Only these tests run
   * that arm: every other DDA test in this file walks +X, and the determinism
   * property that does reach it asserts nothing about the ANSWER — two runs of
   * a wrong traversal agree with each other perfectly.
   */
  const NEGATIVE_AXES = [
    {
      direction: vec3(-1, 0, 0),
      cellAfter: (crossings: number) => [-crossings, 0, 0] as const,
      normal: { x: 1, y: 0, z: 0 },
      entryPoint: { x: -2, y: OFF_CENTRE, z: OFF_CENTRE },
    },
    {
      direction: vec3(0, -1, 0),
      cellAfter: (crossings: number) => [0, -crossings, 0] as const,
      normal: { x: 0, y: 1, z: 0 },
      entryPoint: { x: OFF_CENTRE, y: -2, z: OFF_CENTRE },
    },
    {
      direction: vec3(0, 0, -1),
      cellAfter: (crossings: number) => [0, 0, -crossings] as const,
      normal: { x: 0, y: 0, z: 1 },
      entryPoint: { x: OFF_CENTRE, y: OFF_CENTRE, z: -2 },
    },
  ] as const

  const offCentreOrigin = vec3(OFF_CENTRE, OFF_CENTRE, OFF_CENTRE)

  it.effect('walks the NEGATIVE direction on all three axes, one cell at a time', () =>
    Effect.sync(() => {
      // Looking down or backwards is not an exotic case — it is half of all
      // play. A negative traversal that skips or repeats a cell is a block the
      // player cannot mine while looking straight at it.
      for (const axis of NEGATIVE_AXES) {
        const visited: Array<string> = []
        voxelRaycast(offCentreOrigin, axis.direction, 5, (bx, by, bz) => {
          visited.push(`${bx},${by},${bz}`)
          return false
        })
        expect(visited).toStrictEqual([1, 2, 3, 4, 5].map((crossings) => axis.cellAfter(crossings).join(',')))
      }
    }),
  )

  it.effect('reports the entered face, distance and point for a negative-direction hit', () =>
    Effect.sync(() => {
      // The +X case is asserted above. Mirroring it on the negative side is
      // what pins the two things the negative arm computes differently: the
      // first crossing distance, and the sign of the normal.
      for (const axis of NEGATIVE_AXES) {
        const target = axis.cellAfter(3)
        const hit = voxelRaycast(offCentreOrigin, axis.direction, 8, solidAt(target))
        expect(Option.isSome(hit)).toBe(true)
        if (Option.isSome(hit)) {
          expect([hit.value.bx, hit.value.by, hit.value.bz]).toStrictEqual([...target])
          // Points BACK at the ray, so it is the positive unit vector here.
          expect(hit.value.normal).toStrictEqual(axis.normal)
          // 0.75 to leave the origin cell, then two whole cells. Reading 2.25
          // here means the positive-direction formula is being used: the ray
          // would be measuring its distance to the boundary it is moving AWAY
          // from, and every reach check downstream would be off by half a cell.
          expect(hit.value.distance).toBeCloseTo(OFF_CENTRE + 2, 12)
          expect(hit.value.point).toStrictEqual(axis.entryPoint)
        }
      }
    }),
  )

  it.effect('a ray starting exactly ON a boundary and going negative enters the cell behind it', () =>
    Effect.sync(() => {
      // The degenerate input for the negative first-crossing distance: at an
      // exact boundary `origin - cell` is 0, so the ray leaves its cell
      // immediately. Computed with the positive-direction formula it would be a
      // full cell instead, and the traversal would start one cell too far along
      // — a block you can stand against and not be able to hit.
      const visited: Array<string> = []
      voxelRaycast(vec3(3, 0.5, 0.5), vec3(-1, 0, 0), 3, (bx, by, bz) => {
        visited.push(`${bx},${by},${bz}`)
        return false
      })
      expect(visited).toStrictEqual(['2,0,0', '1,0,0', '0,0,0', '-1,0,0'])
    }),
  )

  it.effect('steps the correct axis when the direction mixes signs', () =>
    Effect.sync(() => {
      // The sign choice is PER AXIS. A negative formula applied globally, or a
      // positive one left in place on one axis, still produces a monotone walk
      // — just the wrong staircase. Asserting the staircase is what tells them
      // apart.
      //
      // The ray leaves +X first because it starts closer to its +X boundary
      // (0.25 away) than to its -Y one (0.75 away), and thereafter the two
      // alternate. Get the -Y arm wrong and it starts 0.25 away instead, so the
      // very first cell is (0,-1,0) rather than (1,0,0).
      const visited: Array<string> = []
      voxelRaycast(vec3(0.5, OFF_CENTRE, 0.5), vec3(1, -1, 0), 4, (bx, by, bz) => {
        visited.push(`${bx},${by},${bz}`)
        return false
      })
      expect(visited).toStrictEqual(['1,0,0', '1,-1,0', '2,-1,0', '2,-2,0', '3,-2,0', '3,-3,0'])
    }),
  )

  it.effect('an all-negative diagonal arrives at the right cell through the right face', () =>
    Effect.sync(() => {
      // All three negative arms at once, plus the tie-break between them. The
      // three tMax values are equal at every step here, so the order in which
      // the axes are consulted is fully exposed: X, then Y, then Z.
      const hit = voxelRaycast(offCentreOrigin, vec3(-1, -1, -1), 16, solidAt([-2, -2, -2]))
      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) {
        // Z was the last axis stepped, so Z is the face that was entered. Get
        // any one of the three arms wrong and that axis falls out of step with
        // the other two, which changes WHICH face the hit is attributed to —
        // and the face normal is what decides where a placed block goes.
        expect(hit.value.normal).toStrictEqual({ x: 0, y: 0, z: 1 })
        // 1.75 cells along each axis, i.e. 1.75 * sqrt(3) along a unit diagonal.
        expect(hit.value.distance).toBeCloseTo((OFF_CENTRE + 1) * Math.sqrt(3), 12)
        expect(hit.value.point.x).toBeCloseTo(-1, 12)
        expect(hit.value.point.y).toBeCloseTo(-1, 12)
        expect(hit.value.point.z).toBeCloseTo(-1, 12)
      }
    }),
  )

  it.effect('measures maxDistance in blocks in the negative direction too', () =>
    Effect.sync(() => {
      // The +X form of this is asserted above. Repeated on the negative side
      // because the distances it compares come out of the negative first-
      // crossing formula, so a bug there shifts reach without changing which
      // cells are visited — a player whose range is silently short by one.
      // The fifth cell back is entered at 0.75 + 4 blocks, so 4.7 falls short
      // and 4.8 reaches. Under the positive-direction formula it would be
      // entered at 4.25 and 4.7 would reach it, which is the assertion below
      // that fails first.
      for (const axis of NEGATIVE_AXES) {
        const target = solidAt(axis.cellAfter(5))
        expect(Option.isNone(voxelRaycast(offCentreOrigin, axis.direction, 4.7, target))).toBe(true)
        expect(Option.isSome(voxelRaycast(offCentreOrigin, axis.direction, 4.8, target))).toBe(true)
      }
    }),
  )

  it.effect('is deterministic: the same ray against the same world always gives the same hit', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
          FastCheck.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true }),
          (dx, dy, dz) => {
            const target = solidAt([4, 0, 0])
            const first = voxelRaycast(vec3(0.5, 0.5, 0.5), vec3(dx, dy, dz), 16, target)
            const second = voxelRaycast(vec3(0.5, 0.5, 0.5), vec3(dx, dy, dz), 16, target)
            return JSON.stringify(first) === JSON.stringify(second)
          },
        ),
        { numRuns: 200 },
      )
    }),
  )
})
