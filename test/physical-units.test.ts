import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { InverseMass, Mass } from '../src/domain/physical-units'

describe('mass units', () => {
  it('accepts positive finite mass and non-negative finite inverse mass', () => {
    expect(Result.isSuccess(Mass.result(1))).toBe(true)
    expect(Result.isSuccess(InverseMass.result(0))).toBe(true)
    expect(Result.isSuccess(InverseMass.result(0.5))).toBe(true)
  })

  it('rejects invalid mass and inverse mass at the Result boundary', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Result.isFailure(Mass.result(value))).toBe(true)
    }
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Result.isFailure(InverseMass.result(value))).toBe(true)
    }
  })
})
