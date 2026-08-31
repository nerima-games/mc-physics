---
"@nerima-games/mc-physics": patch
---

Bump the `@nerima-games/mc-kernel` pin from 0.5.0 to 0.7.0 (exact). The two releases in between only added a `blastResistance` property column and fixed unrelated drop-table rows; the block registry's `collisionShape` assignments and every export this package consumes (`Position`, `DeltaTimeSecs`, `CollisionShape`, `BlockProperties`, `BlockCapabilities`, `FluidKind`, `resolveBlockProperties`, `isEmpty`, `resolvedBlockOfId`, `blockIdOf`, `blockPosition`) are unchanged, so this is a pure pin alignment with no source changes.
