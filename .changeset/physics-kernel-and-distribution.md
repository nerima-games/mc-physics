---
"@nerima-games/mc-physics": minor
---

Use mc-kernel's `BlockProperties` and `DeltaTimeSecs` directly, split collision resolution into focused modules, and publish ESM JavaScript with declaration files from `dist/`. The world query now resolves block IDs and states before passing properties to the physics layer; optional state-specific shapes remain authoritative when supplied.

Add a bounded, deterministic explosion planner that reports block mutations and entity effects without owning world or entity state.

Move the pure primed-TNT fuse and detonation projection into this package, reusing the explosion planner without owning world or entity state.
