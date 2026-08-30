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
  'CACTUS_SHAPE',
  'COLLISION_SHAPE_AABBS',
  'CONTACT_EPSILON',
  'CentreY',
  'DEFAULT_ENTITY_COLLISION_OPTIONS',
  'DEFAULT_EXPLOSION_LIMITS',
  'DEFAULT_GLIDE_CONFIG',
  'DEFAULT_TNT_FUSE_SECS',
  'DeltaTimeSecs',
  'EGG_PROFILE',
  'FIRST_FRAME_DELTA_SECS',
  'FULL_BLOCK_SHAPE',
  'FootY',
  'GRAVITY_Y',
  'HalfHeight',
  'MAX_DELTA_SECS',
  'MAX_ITERATIONS',
  'MAX_TNT_FUSE_ADVANCE_SECS',
  'MIN_CELL_SIZE',
  'MIN_DELTA_SECS',
  'PLAYER_HALF_HEIGHT',
  'PLAYER_HALF_WIDTH',
  'PRESSURE_PLATE_SHAPE',
  'SLAB_SHAPE',
  'SNOWBALL_PROFILE',
  'TERMINAL_VELOCITY_Y',
  'TRIDENT_PROFILE',
  'aabbOfCollisionShape',
  'aabbsOfBlockShape',
  'advanceFallTracking',
  'applyExplosionPlan',
  'applyFluidMotion',
  'applyKnockback',
  'applyMovementInput',
  'applyPrimedTntPlan',
  'applySurfaceMotion',
  'blockAABB',
  'blockAtFromKernel',
  'blockEnvironmentFromKernel',
  'blockPropertiesAtFromKernel',
  'centreOfFoot',
  'clampDeltaTime',
  'clampSneakEdge',
  'collidesWith',
  'collisionOf',
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
  'planExplosion',
  'planPrimedTnt',
  'position',
  'potentialPairs',
  'primeTnt',
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
  'voxelRaycast',
]

try {
  const packageSpecifier = [packageJson.name.split('/')[0], packageJson.name.split('/')[1]].join('/')
  const physics = await import(packageSpecifier)

  assert.deepEqual(Object.keys(physics).sort(), expectedExports)
  assert.equal(physics.DeltaTimeSecs(0), 0)
  assert.equal(physics.FULL_BLOCK_SHAPE.minX, 0)
  assert.equal(typeof physics.voxelRaycast, 'function')
  assert.equal(typeof physics.planExplosion, 'function')

  run('pnpm', ['pack', '--pack-destination', temporaryDirectory])
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
