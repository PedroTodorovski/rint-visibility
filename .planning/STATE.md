---
gsd_state_version: 1.0
milestone: mvp-2026
status: phase_01_mvp
progress:
  total_phases: 2
  completed_phases: 1
  percent: 85
---

# STATE — rint-visibility

## Current Position

- **Phase:** 1 — MVP 2026 (lacuna de receita)
- **Branch:** `feat/mvp-2026-engine`
- **Shipped this slice:** gemini-probe-only, sku-cluster-config, integration-ports, shopify/meta/ga4 ports, revenue-gap-engine, dual-track-generator
- **Next:** Reviewer re-verify on PR SHAs; Pedro applies Supabase Database Deploy after merge

## Repo boundaries

| Repo | Owns |
|------|------|
| **rint-visibility** | API, Supabase `rint.*`, migrations, db-guardrails |
| **rint-app** | D1, UI, proxy |

## Decisions Log

- 2026-06-20: MVP 2026 engine slices implemented — Gemini-only probe, ports + cache, lacuna C1/C2 snapshots, dual-track outputs
- 2026-06-19: MVP 2026 pivot — Gemini-only, lacuna C1+C2, dual-track, data minimalism
- 2026-06-17: ADR-002 — migrations here only

## Blockers

- Supabase migration `20260620100000_mvp_2026_engine.sql` authored — **Pedro deploy only**
