# Testing and verification

## Commands

Run these commands from the repository root:

```sh
corepack pnpm verify
corepack pnpm test:coverage
corepack pnpm package:verify
corepack pnpm audit
nix run nixpkgs#actionlint -- .github/workflows/*.yaml
```

`verify` runs the build and test TypeScript checks, lint, and Vitest. `test:coverage` runs the Vitest suite with V8 coverage. `package:verify` builds the package, checks runtime and declaration exports, packs it, and verifies the archive. CI uses Node.js 26 and the pnpm version pinned in `package.json`; Node.js 24 remains the package engine minimum.

Coverage thresholds are 100% for statements, branches, functions, and lines. The two type-only modules `src/domain/environment-types.ts` and `src/domain/resolve-types.ts` are excluded because they emit no runtime code. Any V8 ignore must have a local reachability proof; the thresholds must not be lowered to make a check pass.

## Behavior contracts

| Area | Tests |
| --- | --- |
| Coordinates and units | Finite brands, invalid brand inputs, coordinate conversions, physical units, and compile-time separation of incompatible dimensions. |
| Time and integration | Kernel frame clamp, timestamp validation, fixed-step Euler integration, terminal velocity, and the 0.05 second tunneling bound. |
| Collision resolution | AABB boundaries, support, step-up, swept movement, sneak-edge clamping, grounding, and one hazard sample from the post-collision AABB. |
| Movement and flight | Walk, sprint, sneak, jump, creative-flight toggle, vertical movement, and package-level landing behavior. The host flight-controls E2E remains assigned to mc-host-web. |
| World and environment | Kernel registry adapters, surface effects, block hazards, fluid sampling, falling-block candidates, and contact geometry. |
| Projectile and entity collision | Profile-specific projectile trajectories, swept block/entity hits, invalid inputs, broad/narrow-phase entity detection, and mass-based resolution. |
| Glide and piston | Glide velocity calculations and piston extrusion geometry, including invalid dimensions and collision boundaries. |
| Public package | Exact runtime export set, shared explosion data exports, absence of explosion/TNT execution exports, and packed archive contents. |

Explosion and primed TNT execution tests belong to `mc-sim`; mc-physics keeps tests only for its shared explosion data and public package boundary.

## CI

The CI workflow runs on pull requests and pushes to `main`. It installs the frozen lockfile, then runs `pnpm verify`, changeset status, `pnpm test:coverage`, `pnpm package:verify`, and `pnpm audit` inside the Nix development environment. The workflow uses actionlint-valid GitHub Actions configuration.

For a release candidate, run all commands above against the exact tree intended for the PR. Record each exit status and the coverage summary. A green type check or lint alone does not establish runtime behavior; the test suite and packed-package check are separate gates.
