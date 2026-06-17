---
gsd_state_version: 1.0
milestone: v1.0
status: phase_01_mvp
---

# STATE — rint-visibility

## Role

Engine API for Rint v1 AI visibility. **Owns Supabase `rint` schema** (migrations + deploy CI).

## Current slice

`visibility-api-crud` — on `feat/visibility-api-crud` (PR pending)

## Completed

- `db-ownership` ✓ — Supabase CI migrated from rint-admin (ADR-002, PR #1)
- `mvp-schema` ✓ — stores, products, prompts, probe_runs, results, weekly_scores + RLS (PR #2, dev deployed)
- `visibility-api-auth` ✓ — Bearer middleware on `/v1`, smoke `GET /v1/status` (PR #3)

## Next (Phase 1)

1. `visibility-api-crud` — **now**
2. `visibility-probe-runner`
3. `visibility-scoring`
4. … see `../rint-admin/.planning/phases/01-mvp-v1/PLAN.md`

## Verify

```bash
npm run typecheck && npm test && npm run db:guard
```

## GitHub

- Account: **PedroTodorovski**
- App deploy: Railway (separate project)
- DB deploy: **Actions → Database Deploy** on this repo (`dev` / `prod` environments)

## Docs

- `docs/database/GOVERNANCE.md` — rules
- `docs/database/MIGRATION_WORKFLOW.md` — deploy runbook + secrets
