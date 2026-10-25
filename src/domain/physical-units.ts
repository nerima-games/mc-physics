import { Brand, Result } from 'effect'

/** Signed length in Minecraft block units. */
export type BlockLength = number & Brand.Brand<'BlockLength'>
export const BlockLength: Brand.Constructor<BlockLength> = Brand.make(
  (value) => Number.isFinite(value) || 'BlockLength must be finite',
)

/** Signed velocity in blocks per second. */
export type BlocksPerSecond = number & Brand.Brand<'BlocksPerSecond'>
export const BlocksPerSecond: Brand.Constructor<BlocksPerSecond> = Brand.make(
  (value) => Number.isFinite(value) || 'BlocksPerSecond must be finite',
)

/** Signed acceleration in blocks per second squared. */
export type BlocksPerSecondSquared = number & Brand.Brand<'BlocksPerSecondSquared'>
export const BlocksPerSecondSquared: Brand.Constructor<BlocksPerSecondSquared> = Brand.make(
  (value) => Number.isFinite(value) || 'BlocksPerSecondSquared must be finite',
)

/** Non-negative rate per second, used for continuous drag and turn rates. */
export type PerSecond = number & Brand.Brand<'PerSecond'>
export const PerSecond: Brand.Constructor<PerSecond> = Brand.make(
  (value) => (Number.isFinite(value) && value >= 0) || 'PerSecond must be a non-negative finite number',
)

/** Positive simulation mass; static and kinematic bodies need no mass. */
export type Mass = number & Brand.Brand<'Mass'>
export const Mass: Brand.Constructor<Mass> = Brand.make(
  (value) => (Number.isFinite(value) && value > 0) || 'Mass must be a positive finite number',
)

/** Non-negative reciprocal mass used by the collision impulse solver. */
export type InverseMass = number & Brand.Brand<'InverseMass'>
export const InverseMass: Brand.Constructor<InverseMass> = Brand.make(
  (value) => (Number.isFinite(value) && value >= 0) || 'InverseMass must be a non-negative finite number',
)

export type BlockVector = Readonly<{
  readonly x: BlockLength
  readonly y: BlockLength
  readonly z: BlockLength
}>

export type VelocityVector = Readonly<{
  readonly x: BlocksPerSecond
  readonly y: BlocksPerSecond
  readonly z: BlocksPerSecond
}>

export const blockVectorResult = (
  x: number,
  y: number,
  z: number,
): Result.Result<BlockVector, Brand.BrandError> => {
  const xSnapshot = x
  const ySnapshot = y
  const zSnapshot = z
  return Result.map(
    Result.all([BlockLength.result(xSnapshot), BlockLength.result(ySnapshot), BlockLength.result(zSnapshot)]),
    ([validX, validY, validZ]): BlockVector => ({ x: validX, y: validY, z: validZ }),
  )
}

export const velocityVectorResult = (
  x: number,
  y: number,
  z: number,
): Result.Result<VelocityVector, Brand.BrandError> => {
  const xSnapshot = x
  const ySnapshot = y
  const zSnapshot = z
  return Result.map(
    Result.all([
      BlocksPerSecond.result(xSnapshot),
      BlocksPerSecond.result(ySnapshot),
      BlocksPerSecond.result(zSnapshot),
    ]),
    ([validX, validY, validZ]): VelocityVector => ({ x: validX, y: validY, z: validZ }),
  )
}
