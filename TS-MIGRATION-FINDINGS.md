# TypeScript Migration — Latent Bugs Found (issue #4)

Real bugs surfaced by the migration's stricter tooling (esbuild / tsc). Per the
migration rules these are **NOT fixed inside migration commits** — a migration
commit must be byte-identical at runtime. They are recorded here to be fixed
separately (own commit / own issue).

## 1. Duplicate `case 'coreDown'` in client event banners (dead code)
`public/client.ts` — the event-banner `switch (ev.type)` has two
`case 'coreDown':` clauses:
- (~line 573) `{ text: 'THE CORE HAS FALLEN', blood: true }` — stronghold core
- (~line 596) `` { text: `${TEAM_NAME[ev.team] ?? 'A'} ANCHOR SHATTERED`, blood: true } `` — Anchor Siege (MOBA)

The second is unreachable: JS matches the first `'coreDown'` case, so the siege
anchor banner never shows. In Anchor Siege a falling core shows
"THE CORE HAS FALLEN" instead of the intended team-specific "X ANCHOR SHATTERED".
Cosmetic only (banner text; no sim/wire effect). Surfaced by esbuild's
`duplicate-case` warning. Fix separately: give the siege anchor a distinct event
type, or branch on mode inside a single `coreDown` case.
