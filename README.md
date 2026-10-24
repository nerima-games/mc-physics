# @nerima-games/mc-physics

Pure physics calculations for a voxel world. The package provides integration, AABB collision resolution, voxel DDA, environment sampling, movement, creative-flight state transitions, projectiles, entity collision, glide, and piston extrusion. It does not own world state or depend on an external physics engine.

## Responsibility

mc-physics receives world queries and game values through its APIs, then returns validated values and calculation results. Callers own chunk access, entity and block state, tick ordering, and applying health, damage, or world mutations. Explosion and primed TNT execution belong to `mc-sim`; mc-physics keeps the shared explosion data types and `DEFAULT_EXPLOSION_LIMITS` from mc-kernel.

Creative-flight functions are pure state transitions. The host owns input event timing and applying the resulting game state. The creative-flight host E2E check is tracked separately from this package's unit contract.

## Validation and units

The public API uses mc-kernel 0.9 brands where a shared unit or identifier exists. Physics-specific units such as block length, blocks per second, acceleration, and mass use semantic types from this package. Dimensionless coefficients and movement axes remain numbers.

Effect 4 `Brand` constructors validate values. Use `.option(value)` when invalid input means absence, or `.result(value)` when the caller must handle the validation error. APIs that can fail while validating inputs or derived values return `Result`; registry lookup preserves mc-kernel's `Option` and `Result` contracts.

## Frame timing

Use mc-kernel's `clampFrameDelta` at the frame boundary. `deltaTimeBetween` accepts monotonic timestamp readings and returns a `Result`. The fixed-step `integrateBody` does not clamp its delta internally.

```ts
import { clampFrameDelta, position } from '@nerima-games/mc-physics'
import { PositionAxis } from '@nerima-games/mc-kernel'

const delta = clampFrameDelta(rawFrameDeltaSecs)
const spawnPosition = position(PositionAxis(0), PositionAxis(64), PositionAxis(0))
```

## Development

The package requires Node.js 24 or newer and uses the pnpm version pinned by Corepack.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm test:coverage
corepack pnpm package:verify
corepack pnpm audit
```

`verify` runs type checks, lint, and tests. `test:coverage` enforces 100% statements, branches, functions, and lines. `package:verify` builds the package and checks the packed archive and public API.

## Documentation

- [Responsibilities](./docs/responsibility.md)
- [Public API overview](./docs/public-api.md)
- [0.4.0 migration guide](./docs/migration-0.4.0.md)
- [Testing and release checks](./docs/testing.md)
- [Design notes](./docs/design-notes.md)
- [Porting history](./docs/porting.md)

## License

MIT
