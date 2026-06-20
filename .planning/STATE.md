---
gsd_state_version: 1.0
milestone: mvp-2026
status: phase_01_mvp
progress:
  total_phases: 2
  completed_phases: 1
  percent: 35
---

# STATE — rint-visibility

## Current Position

- **Phase:** 1 — MVP 2026 (lacuna de receita)
- **Active program:** [MVP-DEFINITION.md](../../rint-admin/.planning/MVP-DEFINITION.md)
- **Foundation shipped:** probe runs API, citation metadata, trust-layer evidence
- **Next slice:** `gemini-probe-only` (documented)

## Repo boundaries

| Repo | Owns |
|------|------|
| **rint-visibility** | API, Supabase `rint.*`, migrations, db-guardrails |
| **rint-admin** | D1, UI, proxy |

## Decisions Log

- 2026-06-19: MVP 2026 pivot — Gemini-only, lacuna C1+C2, dual-track, data minimalism
- 2026-06-17: Probe runs API + batch probe foundation
- 2026-06-17: ADR-002 — migrations here only

## Blockers

- None (docs+pivot complete; implementation slices pending)
