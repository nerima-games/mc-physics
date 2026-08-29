import {
  type ExplosionLimits,
  type ExplosionMutation,
  type ExplosionPlan,
  type ExplosionRequest,
  planExplosion,
} from './explosion'

export const DEFAULT_TNT_FUSE_SECS = 4
export const MAX_TNT_FUSE_ADVANCE_SECS = 10

export type PrimedTntState =
  | Readonly<{ kind: 'primed'; remainingFuseSecs: number }>
  | Readonly<{ kind: 'detonated' }>

export type PrimedTntRequest = Omit<ExplosionRequest, 'limits'> & {
  readonly state: PrimedTntState
  readonly deltaTimeSecs: number
  readonly limits?: Partial<ExplosionLimits>
}

export type PrimedTntPlan = Readonly<{
  readonly before: PrimedTntState
  readonly after: PrimedTntState
  readonly advancedSecs: number
  readonly deferredSecs: number
  readonly explosion?: ExplosionPlan
}>

export type PrimedTntMutation = Readonly<{
  readonly expected: PrimedTntState
  readonly next: PrimedTntState
  readonly explosion?: ExplosionMutation
}>

export type PrimedTntCommit = (mutation: PrimedTntMutation) => void

const finiteNonNegative = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, value)
}

export const primeTnt = (fuseSecs = DEFAULT_TNT_FUSE_SECS): PrimedTntState => ({
  kind: 'primed',
  remainingFuseSecs: finiteNonNegative(fuseSecs),
})

export const planPrimedTnt = (request: PrimedTntRequest): PrimedTntPlan => {
  const requestedSecs = finiteNonNegative(request.deltaTimeSecs)
  const advancedSecs = Math.min(requestedSecs, MAX_TNT_FUSE_ADVANCE_SECS)
  const deferredSecs = requestedSecs - advancedSecs

  if (request.state.kind === 'detonated') {
    return {
      advancedSecs: 0,
      after: request.state,
      before: request.state,
      deferredSecs: 0,
    }
  }

  const remainingFuseSecs = finiteNonNegative(request.state.remainingFuseSecs)
  if (advancedSecs < remainingFuseSecs) {
    return {
      advancedSecs,
      after: {
        kind: 'primed',
        remainingFuseSecs: remainingFuseSecs - advancedSecs,
      },
      before: request.state,
      deferredSecs,
    }
  }

  return {
    advancedSecs: remainingFuseSecs,
    after: { kind: 'detonated' },
    before: request.state,
    deferredSecs,
    explosion: planExplosion(request),
  }
}

export const applyPrimedTntPlan = (plan: PrimedTntPlan, commit: PrimedTntCommit): void => {
  if (plan.explosion) {
    commit({
      expected: plan.before,
      explosion: {
        destroyedBlocks: plan.explosion.destroyedBlocks,
        entityEffects: plan.explosion.entityEffects,
      },
      next: plan.after,
    })
    return
  }

  commit({ expected: plan.before, next: plan.after })
}
