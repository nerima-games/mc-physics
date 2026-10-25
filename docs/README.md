# Documentation

These documents describe the public package boundary and the behavior implemented in mc-physics. Exact TypeScript declarations are published from `dist/index.d.ts`; the public API guide summarizes the contracts that callers need to understand.

## Reading order

| Document | Purpose |
| --- | --- |
| [Architecture](./architecture.md) | Repository layers, dependency boundaries, and the place of mc-physics. |
| [Responsibilities](./responsibility.md) | Calculations owned by this package and behavior left to callers. |
| [Public API](./public-api.md) | Public modules, validated values, and caller-facing behavior. |
| [Migration to 0.4.0](./migration-0.4.0.md) | Breaking changes and migration steps from 0.3.x. |
| [Design notes](./design-notes.md) | Design constraints and regression cases, including historical implementation findings. |
| [Porting history](./porting.md) | Source locations and historical porting decisions. Section 7 records the pre-0.4.0 explosion/TNT re-export. |
| [Testing](./testing.md) | Verification commands, coverage requirements, and test contracts. |
| [Versioning](./versioning.md) | 0.x versioning and package publication policy. |

## Current behavior

- The frame boundary uses mc-kernel's `clampFrameDelta`; `integrateBody` consumes one fixed-step delta without clamping it.
- `Resolution` reports hazards sampled once from the post-collision AABB. Applying contact damage, suffocation, or climbing effects remains the caller's responsibility.
- Movement includes sneak input. Creative-flight transitions are pure calculations; host input timing and creative-mode E2E remain outside this package.
- Explosion and primed TNT execution belong to `mc-sim`. mc-physics exports only the shared explosion data types and `DEFAULT_EXPLOSION_LIMITS`.

## Documentation policy

Write public documentation in English. Keep identifiers, paths, flags, and commands unchanged. Claims about reference behavior must include the source path and line evidence; unverified behavior must be described as such.
