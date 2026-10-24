import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { BlockAxis, DeltaTimeSecs, PositionAxis, resolveBlockProperties } from '@nerima-games/mc-kernel'
import { CentreY, PLAYER_HALF_HEIGHT } from '../src/domain/coordinates.js'
import type { Body } from '../src/domain/integrate.js'
import { stepBody, type ResolveOptions } from '../src/domain/resolve.js'
import { BlockLength, BlocksPerSecond, BlocksPerSecondSquared } from '../src/domain/physical-units.js'
import {
  applyCreativeFlightInput,
  createCreativeFlightState,
  toggleCreativeFlight,
} from '../src/domain/creative-flight.js'

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected Result.Success')
}

const bodyOf = (overrides: Partial<Body> = {}): Body => ({
  kind: 'dynamic',
  x: PositionAxis(0.5),
  y: CentreY(2.4),
  z: PositionAxis(0.5),
  vx: BlocksPerSecond(0),
  vy: BlocksPerSecond(0),
  vz: BlocksPerSecond(0),
  ...overrides,
})

const flightEnabled = toggleCreativeFlight(createCreativeFlightState(), true, true)

describe('creative flight', () => {
  it('toggles only on the caller-provided press event and disables when flight is unavailable', () => {
    const disabled = createCreativeFlightState()
    const enabled = toggleCreativeFlight(disabled, true, true)

    expect(enabled.enabled).toBe(true)
    expect(toggleCreativeFlight(enabled, true, false)).toBe(enabled)
    expect(toggleCreativeFlight(enabled, true, true).enabled).toBe(false)
    expect(toggleCreativeFlight(enabled, false, false).enabled).toBe(false)
    expect(toggleCreativeFlight(disabled, false, false)).toBe(disabled)
  })

  it('sets vertical speed for ascend and descend, with neutral and simultaneous input cancelling', () => {
    const body = bodyOf({ vx: BlocksPerSecond(2), vz: BlocksPerSecond(-3) })
    const ascend = unwrap(applyCreativeFlightInput(body, flightEnabled, { ascend: true, descend: false }, BlocksPerSecond(4)))
    const descend = unwrap(applyCreativeFlightInput(body, flightEnabled, { ascend: false, descend: true }, BlocksPerSecond(4)))
    const neutral = unwrap(applyCreativeFlightInput(body, flightEnabled, { ascend: false, descend: false }, BlocksPerSecond(4)))
    const cancelled = unwrap(applyCreativeFlightInput(body, flightEnabled, { ascend: true, descend: true }, BlocksPerSecond(4)))

    expect(ascend).toEqual({ ...body, vy: BlocksPerSecond(4) })
    expect(descend).toEqual({ ...body, vy: BlocksPerSecond(-4) })
    expect(neutral.vy).toBe(0)
    expect(cancelled.vy).toBe(0)
    expect(ascend.vx).toBe(body.vx)
    expect(ascend.vz).toBe(body.vz)
  })

  it('does not move when flight is disabled or the body is not dynamic', () => {
    const body = bodyOf()
    expect(applyCreativeFlightInput(body, createCreativeFlightState(), { ascend: true, descend: false }, BlocksPerSecond(4)))
      .toEqual(Result.succeed(body))
    const staticBody = bodyOf({ kind: 'static' })
    expect(applyCreativeFlightInput(staticBody, flightEnabled, { ascend: true, descend: false }, BlocksPerSecond(4)))
      .toEqual(Result.succeed(staticBody))
  })

  it('rejects invalid vertical speed at the Result boundary', () => {
    expect(Result.isFailure(applyCreativeFlightInput(
      bodyOf(),
      flightEnabled,
      { ascend: true, descend: false },
      // @ts-expect-error Exercise runtime rejection of a malformed branded value.
      Number.NaN,
    ))).toBe(true)
  })

  it('keeps the largest finite configured speed within the branded result', () => {
    const maximumFiniteSpeed = BlocksPerSecond(Number.MAX_VALUE)
    const result = applyCreativeFlightInput(
      bodyOf(),
      flightEnabled,
      { ascend: true, descend: false },
      maximumFiniteSpeed,
    )

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) expect(result.success.vy).toBe(Number.MAX_VALUE)
  })

  it('hands a landing to body resolution without disabling the external flight state', () => {
    const floor = unwrap(resolveBlockProperties({ collisionShape: 'full' }))
    const options: ResolveOptions = {
      halfWidth: BlockLength(0.3),
      halfHeight: PLAYER_HALF_HEIGHT,
      environment: { blockAt: () => null },
      blockPropertiesAt: (_bx, by, _bz) => by === BlockAxis(0) ? floor : null,
    }
    const descending = unwrap(applyCreativeFlightInput(
      bodyOf(),
      flightEnabled,
      { ascend: false, descend: true },
      BlocksPerSecond(4),
    ))
    const landing = unwrap(stepBody(
      descending,
      DeltaTimeSecs(0.2),
      options,
      { gravityY: BlocksPerSecondSquared(0) },
    ))
    const flightAfterLanding = toggleCreativeFlight(flightEnabled, true, false)

    expect(landing.isGrounded).toBe(true)
    expect(landing.body.vy).toBe(0)
    expect(flightAfterLanding).toBe(flightEnabled)
  })
})
