import { describe, expect, it } from 'vitest'
import { CentreY } from '../src/domain/coordinates'
import {
  advanceFallTracking,
  createFallTrackingState,
  resetFallTrackingState,
} from '../src/domain/landing'
import type { Body } from '../src/domain/integrate'
import type { Resolution } from '../src/domain/resolve-types'

const bodyAt = (y: number, vy = 0): Body => ({
  kind: 'dynamic',
  x: 0.5,
  y: CentreY(y),
  z: 0.5,
  vx: 0,
  vy,
  vz: 0,
})

const resolutionAt = (y: number, isGrounded: boolean): Resolution => ({
  body: bodyAt(y),
  isGrounded,
})

describe('fall tracking', () => {
  it('creates and resets a state with an explicit grounded status', () => {
    expect(createFallTrackingState()).toEqual({ accumulatedFallDistance: 0, isGrounded: false })
    expect(resetFallTrackingState()).toEqual({ accumulatedFallDistance: 0, isGrounded: false })
    expect(resetFallTrackingState(true)).toEqual({ accumulatedFallDistance: 0, isGrounded: true })
  })

  it('accumulates actual downward movement while descending', () => {
    const transition = advanceFallTracking(
      createFallTrackingState(false),
      bodyAt(5),
      bodyAt(4.9, -3),
      resolutionAt(4.75, false),
    )
    expect(transition).toEqual({
      state: { accumulatedFallDistance: 0.25, isGrounded: false },
      landingImpact: null,
    })
  })

  it('carries distance across frames and emits one landing impact', () => {
    const transition = advanceFallTracking(
      { accumulatedFallDistance: 0.25, isGrounded: false },
      bodyAt(4.75),
      bodyAt(4.7, -6),
      resolutionAt(4.25, true),
    )
    expect(transition).toEqual({
      state: { accumulatedFallDistance: 0, isGrounded: true },
      landingImpact: { fallDistance: 0.75, impactVelocityY: -6 },
    })
  })

  it('does not count upward movement or grounded-to-grounded contact as a landing', () => {
    expect(
      advanceFallTracking(
        { accumulatedFallDistance: 3, isGrounded: true },
        bodyAt(2),
        bodyAt(2.2, 4),
        resolutionAt(2.2, false),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: 0, isGrounded: false },
      landingImpact: null,
    })

    expect(
      advanceFallTracking(
        { accumulatedFallDistance: 3, isGrounded: true },
        bodyAt(2),
        bodyAt(1.9, -1),
        resolutionAt(2, true),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: 0, isGrounded: true },
      landingImpact: null,
    })

    expect(
      advanceFallTracking(
        { accumulatedFallDistance: 0, isGrounded: false },
        bodyAt(2),
        bodyAt(1.9, -1),
        resolutionAt(2, true),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: 0, isGrounded: true },
      landingImpact: null,
    })
  })

  it('normalizes invalid accumulated distance, movement distance, and velocity', () => {
    expect(
      advanceFallTracking(
        { accumulatedFallDistance: Number.NaN, isGrounded: false },
        bodyAt(Number.NaN),
        bodyAt(1, Number.POSITIVE_INFINITY),
        resolutionAt(0, true),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: 0, isGrounded: true },
      landingImpact: null,
    })

    expect(
      advanceFallTracking(
        { accumulatedFallDistance: -1, isGrounded: false },
        bodyAt(1),
        bodyAt(0.5, -1),
        resolutionAt(0.75, false),
      ),
    ).toEqual({
      state: { accumulatedFallDistance: 0.25, isGrounded: false },
      landingImpact: null,
    })
  })
})
