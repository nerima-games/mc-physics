import { performance } from 'node:perf_hooks'
import { detectEntityCollisions } from '../dist/index.js'

const entities = Array.from({ length: 256 }, (_, index) => {
  const pair = Math.floor(index / 2)
  const offset = index % 2 === 0 ? 0 : 0.4
  return {
    id: `entity-${index}`,
    body: {
      kind: 'dynamic',
      x: (pair % 16) * 1.5 + offset,
      y: 0.9,
      z: Math.floor(pair / 16) * 1.5,
      vx: 0,
      vy: 0,
      vz: 0,
    },
    halfWidth: 0.3,
    halfHeight: 0.9,
    mass: 1,
  }
})
const warmupIterations = 20
const measuredIterations = 200

for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
  detectEntityCollisions(entities)
}

const start = performance.now()
let collisionCount = 0
for (let iteration = 0; iteration < measuredIterations; iteration += 1) {
  collisionCount += detectEntityCollisions(entities).length
}
const elapsedMs = performance.now() - start
if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
  throw new Error('benchmark did not produce a positive elapsed time')
}

process.stdout.write(`${JSON.stringify({
  entities: entities.length,
  iterations: measuredIterations,
  collisions: collisionCount,
  elapsedMs: Number(elapsedMs.toFixed(3)),
  operationsPerSecond: Math.round(measuredIterations / (elapsedMs / 1000)),
})}\n`)
