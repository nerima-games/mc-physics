import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { CentreY } from '../src/domain/coordinates'
import { BlockLength, BlocksPerSecond } from '../src/domain/physical-units'
import { BlockContactDamage, PositionAxis } from '@nerima-games/mc-kernel'
import {
  advanceFallTracking as advanceFallTrackingResult,
  createFallTrackingState,
  resetFallTrackingState,
} from '../src/domain/landing'
import type { Body } from '../src/domain/integrate'
import type { Resolution } from '../src/domain/resolve-types'

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const advanceFallTracking = (
  state: Parameters<typeof advanceFallTrackingResult>[0],
  before: Body,
  integrated: Body,
  resolution: Resolution,
) => unwrap(advanceFallTrackingResult(state, before, integrated, resolution))

const bodyAt = (y: number, vy = 0): Body => ({
  kind: 'dynamic',
  x: PositionAxis(0.5),
  y: CentreY(y),
  z: PositionAxis(0.5),
  vx: BlocksPerSecond(0),
  vy: BlocksPerSecond(vy),
  vz: BlocksPerSecond(0),
})

const resolutionAt = (y: number, isGrounded: boolean): Resolution => ({
  body: bodyAt(y),
  isGrounded,
  hazards: { contactDamage: BlockContactDamage(0), suffocating: false, climbable: false },
})

describe('fall tracking', () => {
  it('creates and resets a state with an explicit grounded status', () => {
    expect(createFallTrackingState()).toEqual({ accumulatedFallDistance: BlockLength(0), isGrounded: false })
    expect(resetFallTrackingState()).toEqual({ accumulatedFallDistance: BlockLength(0), isGrounded: false })
    expect(resetFallTrackingState(true)).toEqual({ accumulatedFallDistance: BlockLength(0), isGrounded: true })
  })

  it('accumulates actual downward movement while descending', () => {
    const transition = advanceFallTracking(
      createFallTrackingState(false),
      bodyAt(5),
      bodyAt(4.9, -3),
      resolutionAt(4.75, false),
    )
    expect(transition).toEqual({
      state: { accumulatedFallDistance: BlockLength(0.25), isGrounded: false },
      landingImpact: null,
    })
  })

  it('carries distance across frames and emits one landing impact', () => {
    const transition = advanceFallTracking(
      { accumulatedFallDistance: BlockLength(0.25), isGrounded: false },
      bodyAt(4.75),
      bodyAt(4.7, -6),
      resolutionAt(4.25, true),
    )
    expect(transition).toEqual({
      state: { accumulatedFallDistance: BlockLength(0), isGrounded: true },
      landingImpact: { fallDistance: 0.75, impactVelocityY: -6 },
    })
  })

  it('does not count upward movement or grounded-to-grounded contact as a landing', () => {
    expect(
      advanceFallTracking(
        { accumulatedFallDistance: BlockLength(3), isGrounded: true },
        bodyAt(2),
        bodyAt(2.2, 4),
        resolutionAt(2.2, false),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: BlockLength(0), isGrounded: false },
      landingImpact: null,
    })

    expect(
      advanceFallTracking(
        { accumulatedFallDistance: BlockLength(3), isGrounded: true },
        bodyAt(2),
        bodyAt(1.9, -1),
        resolutionAt(2, true),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: BlockLength(0), isGrounded: true },
      landingImpact: null,
    })

    expect(
      advanceFallTracking(
        { accumulatedFallDistance: BlockLength(0), isGrounded: false },
        bodyAt(2),
        bodyAt(1.9, -1),
        resolutionAt(2, true),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: BlockLength(0), isGrounded: true },
      landingImpact: null,
    })
  })

  it('returns a failure when invalid state or body scalars cross a branded result boundary', () => {
    const invalid = advanceFallTrackingResult(
      { accumulatedFallDistance: BlockLength(0), isGrounded: false },
      bodyAt(Number.MAX_VALUE),
      bodyAt(1, -1),
      resolutionAt(-Number.MAX_VALUE, false),
    )
    expect(Result.isFailure(invalid)).toBe(true)

    const invalidState = advanceFallTrackingResult(
      { accumulatedFallDistance: Number.NaN as BlockLength, isGrounded: false },
      bodyAt(1),
      bodyAt(1, -1),
      resolutionAt(1, false),
    )
    expect(Result.isFailure(invalidState)).toBe(true)
  })

  it('returns a failure when accumulated and current fall distances overflow together', () => {
    const largeFiniteDistance = Number.MAX_VALUE * 0.75
    const result = advanceFallTrackingResult(
      { accumulatedFallDistance: BlockLength(largeFiniteDistance), isGrounded: false },
      bodyAt(largeFiniteDistance),
      bodyAt(largeFiniteDistance, -1),
      resolutionAt(0, false),
    )

    expect(Result.isFailure(result)).toBe(true)
  })

  it('clamps valid negative accumulated distance to zero', () => {
    expect(
      advanceFallTracking(
        { accumulatedFallDistance: BlockLength(-1), isGrounded: false },
        bodyAt(1),
        bodyAt(0.5, -1),
        resolutionAt(0.75, false),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: BlockLength(0.25), isGrounded: false },
      landingImpact: null,
    })
  })
})
