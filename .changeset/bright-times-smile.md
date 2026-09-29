---
"@nerima-games/mc-physics": minor
---

Migrate physics time contracts to `mc-kernel` 0.8.0. `FIRST_FRAME_DELTA_SECS` now has the kernel `DeltaTimeSecs` type, while `MIN_DELTA_SECS` and `MAX_DELTA_SECS` are re-exports of the kernel frame-timing constants. Fixed tick timing uses `FixedDurationSecs`, and the compile fixture locks the public brand boundaries.
