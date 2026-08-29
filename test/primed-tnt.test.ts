import { describe, expect, it, vi } from 'vitest'
import {
  applyPrimedTntPlan,
  DEFAULT_TNT_FUSE_SECS,
  MAX_TNT_FUSE_ADVANCE_SECS,
  planPrimedTnt,
  primeTnt,
} from '../src/index'

const air = () => ({ resistance: 0, destructible: false })
const request = (state = primeTnt(), deltaTimeSecs = DEFAULT_TNT_FUSE_SECS) => ({
  state,
  deltaTimeSecs,
  center: { x: 0.5, y: 0.5, z: 0.5 },
  radius: 4,
  seed: 17,
  blocks: air,
  entities: [],
})

describe('primed TNT', () => {
  it('uses the four-second default and normalizes a non-finite fuse', () => {
    expect(primeTnt()).toStrictEqual({ kind: 'primed', remainingFuseSecs: 4 })
    expect(primeTnt(Number.NaN)).toStrictEqual({ kind: 'primed', remainingFuseSecs: 0 })
    expect(primeTnt(Number.POSITIVE_INFINITY)).toStrictEqual({ kind: 'primed', remainingFuseSecs: 0 })
  })

  it('advances without producing a blast before the fuse expires', () => {
    const plan = planPrimedTnt(request(primeTnt(4), 1.5))

    expect(plan).toMatchObject({
      after: { kind: 'primed', remainingFuseSecs: 2.5 },
      advancedSecs: 1.5,
      deferredSecs: 0,
    })
    expect(plan.explosion).toBeUndefined()
  })

  it('detonates once and reuses the deterministic bounded explosion planner', () => {
    const first = planPrimedTnt({
      ...request(),
      limits: { maxVisitedBlocks: 3, maxRaySteps: 4, maxAffectedEntities: 0 },
    })
    const terminal = planPrimedTnt(request(first.after, 4))

    expect(first.after).toStrictEqual({ kind: 'detonated' })
    expect(first.explosion).toMatchObject({
      seed: 17,
      visitedBlocks: 3,
      truncated: true,
    })
    expect(terminal).toMatchObject({
      after: { kind: 'detonated' },
      advancedSecs: 0,
      deferredSecs: 0,
    })
    expect(terminal.explosion).toBeUndefined()
  })

  it('normalizes negative and non-finite frame durations', () => {
    const negative = planPrimedTnt(request(primeTnt(2), -1))
    const nonFinite = planPrimedTnt(request(primeTnt(2), Number.POSITIVE_INFINITY))

    expect(negative).toMatchObject({
      after: { kind: 'primed', remainingFuseSecs: 2 },
      advancedSecs: 0,
      deferredSecs: 0,
    })
    expect(nonFinite).toMatchObject({
      after: { kind: 'primed', remainingFuseSecs: 2 },
      advancedSecs: 0,
      deferredSecs: 0,
    })

    const malformedState = planPrimedTnt(
      request({ kind: 'primed', remainingFuseSecs: Number.POSITIVE_INFINITY }, 1),
    )
    expect(malformedState).toMatchObject({
      after: { kind: 'detonated' },
      advancedSecs: 0,
      deferredSecs: 0,
    })
  })

  it('caps oversized frame work and reports time that must be retried', () => {
    const plan = planPrimedTnt(request(primeTnt(30), 25))

    expect(plan).toMatchObject({
      after: { kind: 'primed', remainingFuseSecs: 20 },
      advancedSecs: MAX_TNT_FUSE_ADVANCE_SECS,
      deferredSecs: 15,
    })
  })

  it('commits fuse and blast as one host-owned mutation', () => {
    const plan = planPrimedTnt(request())
    const commit = vi.fn()

    applyPrimedTntPlan(plan, commit)

    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith({
      expected: plan.before,
      next: plan.after,
      explosion: {
        destroyedBlocks: plan.explosion?.destroyedBlocks,
        entityEffects: plan.explosion?.entityEffects,
      },
    })
  })

  it('commits no blast payload while the fuse is still counting down', () => {
    const plan = planPrimedTnt(request(primeTnt(4), 1))
    const commit = vi.fn()

    applyPrimedTntPlan(plan, commit)

    expect(plan.explosion).toBeUndefined()
    expect(commit).toHaveBeenCalledWith({
      expected: plan.before,
      next: plan.after,
    })
  })
})
