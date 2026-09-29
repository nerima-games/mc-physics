import {
  CentreY,
  DeltaTimeSecs,
  FootY,
  HalfHeight,
  integrateBody,
  type Body,
} from '../src/index.js'
import {
  FixedDurationSecs,
  InterpolationFraction,
  MonotonicTimeSecs,
  SessionEpoch,
  SimulationTick,
} from '@nerima-games/mc-kernel'

const body: Body = { kind: 'dynamic', x: 0, y: CentreY(0), z: 0, vx: 0, vy: 0, vz: 0 }
const delta = DeltaTimeSecs(0.05)
const fixedDuration = FixedDurationSecs(0.05)
const centre = CentreY(0)
const foot = FootY(0)
const halfHeight = HalfHeight(0.9)

export const validDelta: DeltaTimeSecs = delta

// @ts-expect-error FixedDurationSecs is not a per-step DeltaTimeSecs.
integrateBody(body, fixedDuration)
// @ts-expect-error MonotonicTimeSecs is not a DeltaTimeSecs.
integrateBody(body, MonotonicTimeSecs(1))
// @ts-expect-error SimulationTick is not a DeltaTimeSecs.
integrateBody(body, SimulationTick(1))
// @ts-expect-error InterpolationFraction is not a DeltaTimeSecs.
integrateBody(body, InterpolationFraction(0.5))
// @ts-expect-error SessionEpoch is not a DeltaTimeSecs.
integrateBody(body, SessionEpoch('session-1'))

// @ts-expect-error FootY and CentreY are distinct coordinate brands.
const centreFromFoot: CentreY = foot
// @ts-expect-error CentreY and HalfHeight are distinct coordinate brands.
const heightFromCentre: HalfHeight = centre
// @ts-expect-error HalfHeight and CentreY are distinct coordinate brands.
const centreFromHeight: CentreY = halfHeight

void validDelta
void centreFromFoot
void heightFromCentre
void centreFromHeight
