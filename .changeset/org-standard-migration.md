---
"@nerima-games/mc-physics": patch
---

Migrate repository layout and tooling onto the nerima-games org standard: move shipped source under `src/`, remove the `api-lock.md`/`scripts/api-lock.ts` snapshot mechanism and `scripts/check-dependency-whitelist.ts` in favour of an `oxlint.json` `no-restricted-imports` rule, SHA-pin third-party GitHub Actions, add Dependabot, enable the 99% coverage gate, and adopt changesets for versioning. No public API change: `src/index.ts` re-exports the same surface as the previous `index.ts`.
