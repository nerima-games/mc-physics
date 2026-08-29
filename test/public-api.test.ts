/**
 * The barrel is what mc-sim imports. A re-export dropped here is invisible to
 * every other test in this repository and breaks the simulation, so it is
 * pinned explicitly.
 *
 * It also pins the constants that plan.md §3.4 records as measured facts about
 * the reference implementation, so that changing one is a deliberate act.
 */
import { describe, expect, it } from 'vitest'
import * as physics from '../src/index'

describe('public API surface', () => {
  it('re-exports every public runtime value', () => {
      const expected = [
        // coordinates
        'FootY',
        'CentreY',
        'HalfHeight',
        'centreOfFoot',
        'footOfCentre',
        'standingPlaneAbove',
        'PLAYER_HALF_WIDTH',
        'PLAYER_HALF_HEIGHT',
        'position',
        'entityAABB',
        'blockAABB',
        'aabbsOfBlockShape',
        'aabbOfCollisionShape',
        'intersects',
        'penetrationY',
        'collidesWith',
        'isRestingOn',
        'CONTACT_EPSILON',
        // shape-data
        'FULL_BLOCK_SHAPE',
        'SLAB_SHAPE',
        'CACTUS_SHAPE',
        'PRESSURE_PLATE_SHAPE',
        'COLLISION_SHAPE_AABBS',
        // delta-time
        'DeltaTimeSecs',
        'MIN_DELTA_SECS',
        'MAX_DELTA_SECS',
        'FIRST_FRAME_DELTA_SECS',
        'clampDeltaTime',
        'deltaTimeBetween',
        'isClampedDelta',
        // integrate
        'GRAVITY_Y',
        'TERMINAL_VELOCITY_Y',
        'integrate',
        'integrateBody',
        'maxFallPerStep',
        // resolve
        'resolveBody',
        'resolveWorld',
        'stepBody',
        'stepWorld',
        'maxSpeedWithoutTunnelling',
        'clampSneakEdge',
        // dda
        'voxelRaycast',
        // projectile (profile-generalized; arrow behaviour lives in ARROW_PROFILE)
        'ARROW_PROFILE',
        'SNOWBALL_PROFILE',
        'EGG_PROFILE',
        'TRIDENT_PROFILE',
        'launchProjectile',
        'stepProjectile',
        // glide (calibration constants stay module-internal; the config object is the API)
        'DEFAULT_GLIDE_CONFIG',
        'glideStep',
        // piston
        'pistonExtrusion',
        // movement
        'applyMovementInput',
        'applyKnockback',
        // kernel-world
        'blockAtFromKernel',
        'blockPropertiesAtFromKernel',
        'blockEnvironmentFromKernel',
        'resolveOptionsFromKernel',
        'fallingBlockCandidateAt',
        // landing
        'createFallTrackingState',
        'resetFallTrackingState',
        'advanceFallTracking',
        // environment
        'sampleSurfaceEffects',
        'applySurfaceMotion',
        'sampleBlockHazards',
        // fluid
        'sampleFluidEffects',
        'applyFluidMotion',
        // explosion and primed TNT
        'planExplosion',
        'applyExplosionPlan',
        'DEFAULT_EXPLOSION_LIMITS',
        'DEFAULT_TNT_FUSE_SECS',
        'MAX_TNT_FUSE_ADVANCE_SECS',
        'primeTnt',
        'planPrimedTnt',
        'applyPrimedTntPlan',
        // entity interaction (broad-phase, narrow-phase, mass, resolution)
        'detectEntityCollisions',
        'resolveEntityCollisions',
        'collisionOf',
        'inverseMassOf',
        'normalizedOptions',
        'potentialPairs',
        'DEFAULT_ENTITY_COLLISION_OPTIONS',
        'MIN_CELL_SIZE',
        'MAX_ITERATIONS',
      ]
      expect(Object.keys(physics).sort()).toEqual([...expected].sort())
  })
})

describe('the measured constants plan.md §3.4 carries over', () => {
  it('pins the delta clamp bounds and the first-frame delta', () => {
      expect(physics.MIN_DELTA_SECS).toBe(0.001)
      expect(physics.MAX_DELTA_SECS).toBe(0.05)
      expect(physics.FIRST_FRAME_DELTA_SECS).toBe(0.016)
  })

  // REGRESSION: the clamp bounds above are the INTEGRATOR's safe range, and the
  // `DeltaTimeSecs` brand deliberately does not enforce them — it mirrors
  // kernel's (mc-kernel/domain/quantities.ts:37-42) "finite, non-negative"
  // refinement exactly, because the two share the brand key `'DeltaTimeSecs'`
  // and are therefore one type to TypeScript. Pinned in the barrel as well as
  // in domain/delta-time.ts, because a consumer meets it through the barrel.
  // See domain/delta-time.ts for why the clamp belongs at the boundary instead.
  it('pins DeltaTimeSecs to kernel’s refinement, with the clamp applied at the boundary', () => {
      expect(physics.DeltaTimeSecs(0)).toBe(0)
      expect(physics.DeltaTimeSecs(30)).toBe(30)
      expect(() => physics.DeltaTimeSecs(-1)).toThrow()
      expect(() => physics.DeltaTimeSecs(Number.NaN)).toThrow()

      expect(physics.isClampedDelta(physics.clampDeltaTime(30))).toBe(true)
      expect(physics.isClampedDelta(30)).toBe(false)
  })

  it('pins gravity, terminal velocity and the player half-extents', () => {
      expect(physics.GRAVITY_Y).toBe(-9.82)
      expect(physics.TERMINAL_VELOCITY_Y).toBe(-32)
      expect(physics.PLAYER_HALF_WIDTH).toBe(0.3)
      expect(Number(physics.PLAYER_HALF_HEIGHT)).toBe(0.9)
  })

  it('keeps terminal velocity strictly inside what the delta cap allows the resolver to catch', () => {
      // 1.8 / 0.05 = 36 is the largest safe magnitude; -32 leaves headroom.
      // Asserting the derivation, not just the number, so that changing either
      // constant without the other fails here.
      const bodyHeight = 2 * Number(physics.PLAYER_HALF_HEIGHT)
      expect(Math.abs(physics.TERMINAL_VELOCITY_Y)).toBeLessThan(bodyHeight / physics.MAX_DELTA_SECS)
      expect(physics.maxFallPerStep(physics.MAX_DELTA_SECS)).toBeLessThanOrEqual(bodyHeight)
  })

  it('the contact epsilon is far above the float error and far below anything perceivable', () => {
      expect(physics.CONTACT_EPSILON).toBeGreaterThan(Number.EPSILON * 1000)
      expect(physics.CONTACT_EPSILON).toBeLessThan(1e-6)
  })
})
