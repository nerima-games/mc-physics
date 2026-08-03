/**
 * @nerima-games/mc-physics — Euler integration and AABB collision, no engine.
 *
 * FIRST CUT (叩き台). See README.md 現状.
 *
 * A tier-1 stable library (plan.md §2.2). It asks the world exactly one
 * question — "is this cell solid, and what shape does it collide with?" — and
 * receives the answer as an injected callback. It therefore depends on no
 * world, no chunk manager, no renderer and no clock.
 *
 * Two rules from plan.md are structural here rather than advisory:
 *
 *   - NO BLOCK-ID NAME CHECKS (§3.4). Passability arrives as a boolean the
 *     caller derived from mc-kernel's capability flags. The reference did the
 *     opposite — a hand-maintained `PASSABLE_BLOCK_IDS` denylist at
 *     `packages/game/domain/block-collision-predicates.ts:16-42`, which shipped
 *     with leaves wrongly listed and let players fall through tree canopies.
 *   - FOOT-ORIGIN Y AND CENTRE Y ARE DIFFERENT TYPES (§3.4). Every "things
 *     float" bug in the reference was a confusion between them. See
 *     domain/coordinates.ts.
 */

export * from './domain/coordinates'
export * from './domain/dda'
export * from './domain/delta-time'
export * from './domain/integrate'
export * from './domain/projectile'
export * from './domain/resolve'
