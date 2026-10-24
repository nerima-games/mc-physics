import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'mc-physics-package-'))
const COMMAND_TIMEOUT_MS = 120_000

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  })
  if (result.error !== undefined || result.status !== 0) {
    const reason = result.error?.message ?? (result.stderr?.trim() || `exit status ${String(result.status)}`)
    throw new Error(`${command} ${args.join(' ')} failed: ${reason}`)
  }
  return result.stdout
}

// Every value the barrel is contracted to export. A name dropping out of this
// list without a matching README/docs update is a public-API break; a name
// appearing that is not in this list means the dist build changed the export
// surface without a review of that change.
const expectedExports = [
  'ARROW_PROFILE',
  'BlockLength',
  'BlocksPerSecond',
  'BlocksPerSecondSquared',
  'CACTUS_SHAPE',
  'COLLISION_SHAPE_AABBS',
  'CONTACT_EPSILON',
  'CentreY',
  'DEFAULT_ENTITY_COLLISION_OPTIONS',
  'DEFAULT_EXPLOSION_LIMITS',
  'DEFAULT_GLIDE_CONFIG',
  'DeltaTimeSecs',
  'EGG_PROFILE',
  'FIRST_FRAME_DELTA_SECS',
  'FULL_BLOCK_SHAPE',
  'FootY',
  'GRAVITY_Y',
  'HalfHeight',
  'InverseMass',
  'MAX_DELTA_SECS',
  'MAX_ITERATIONS',
  'MIN_CELL_SIZE',
  'MIN_DELTA_SECS',
  'Mass',
  'MonotonicTimeSecs',
  'PLAYER_HALF_HEIGHT',
  'PLAYER_HALF_WIDTH',
  'PRESSURE_PLATE_SHAPE',
  'PerSecond',
  'SLAB_SHAPE',
  'SNOWBALL_PROFILE',
  'TERMINAL_VELOCITY_Y',
  'TRIDENT_PROFILE',
  'aabbOfCollisionShape',
  'aabbsOfBlockShape',
  'advanceFallTracking',
  'applyCreativeFlightInput',
  'applyFluidMotion',
  'applyKnockback',
  'applyMovementInput',
  'applySurfaceMotion',
  'blockAABB',
  'blockAtFromKernel',
  'blockEnvironmentFromKernel',
  'blockPropertiesAtFromKernel',
  'blockVectorResult',
  'centreOfFoot',
  'clampFrameDelta',
  'clampSneakEdge',
  'collidesWith',
  'collisionOf',
  'createCreativeFlightState',
  'createFallTrackingState',
  'deltaTimeBetween',
  'detectEntityCollisions',
  'entityAABB',
  'fallingBlockCandidateAt',
  'footOfCentre',
  'glideStep',
  'integrate',
  'integrateBody',
  'intersects',
  'inverseMassOf',
  'isClampedDelta',
  'isRestingOn',
  'launchProjectile',
  'maxFallPerStep',
  'maxSpeedWithoutTunnelling',
  'normalizedOptions',
  'penetrationY',
  'pistonExtrusion',
  'position',
  'potentialPairs',
  'resetFallTrackingState',
  'resolveBody',
  'resolveEntityCollisions',
  'resolveOptionsFromKernel',
  'resolveWorld',
  'sampleBlockHazards',
  'sampleFluidEffects',
  'sampleSurfaceEffects',
  'standingPlaneAbove',
  'stepBody',
  'stepProjectile',
  'stepWorld',
  'toggleCreativeFlight',
  'velocityVectorResult',
  'voxelRaycast',
]

try {
  const packageSpecifier = [packageJson.name.split('/')[0], packageJson.name.split('/')[1]].join('/')
  const physics = await import(packageSpecifier)

  assert.deepEqual(Object.keys(physics).sort(), expectedExports)
  assert.equal(physics.DeltaTimeSecs(0), 0)
  assert.equal(physics.FULL_BLOCK_SHAPE.minX, 0)
  assert.equal(typeof physics.voxelRaycast, 'function')
  assert.equal(typeof physics.applyCreativeFlightInput, 'function')
  assert.equal('planExplosion' in physics, false)
  assert.equal('primeTnt' in physics, false)

  const declaration = readFileSync(join(root, 'dist/index.d.ts'), 'utf8')
  for (const name of [
    'ExplosionBlock',
    'ExplosionBlockPosition',
    'ExplosionBlockReader',
    'ExplosionCommit',
    'ExplosionEntity',
    'ExplosionEntityEffect',
    'ExplosionLimits',
    'ExplosionMutation',
    'ExplosionPlan',
    'ExplosionRequest',
  ]) {
    assert.match(declaration, new RegExp(`\\b${name}\\b`))
  }
  assert.doesNotMatch(declaration, /\bPrimedTnt[A-Za-z]*\b/)

  run('corepack', ['pnpm', 'pack', '--pack-destination', temporaryDirectory])
  const archiveName = readdirSync(temporaryDirectory).find((name) => name.endsWith('.tgz'))
  if (archiveName === undefined) {
    throw new Error('pnpm pack produced no archive')
  }

  const archive = join(temporaryDirectory, archiveName)
  const entries = new Set(run('tar', ['-tzf', archive]).split('\n').filter(Boolean))
  for (const entry of ['package/dist/index.js', 'package/dist/index.d.ts', 'package/LICENSE', 'package/README.md']) {
    if (!entries.has(entry)) {
      throw new Error(`package archive is missing ${entry}`)
    }
  }
  if ([...entries].some((entry) => entry.startsWith('package/src/'))) {
    throw new Error('package archive contains source files')
  }

  process.stdout.write(`verified ${packageJson.name}: ${expectedExports.length} exports, archive ${archiveName}\n`)
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
