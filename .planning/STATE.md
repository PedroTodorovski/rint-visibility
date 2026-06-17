---
gsd_state_version: 1.0
milestone: v1.0
status: phase_01_mvp
---

# STATE — rint-visibility

## Role

Engine API for Rint v1 AI visibility. **Owns Supabase `rint` schema** (migrations + deploy CI).

## Current slice

`visibility-api-auth` — on `feat/visibility-api-auth` (PR pending)

## Completed

- `db-ownership` ✓ — Supabase CI migrated from rint-admin (ADR-002, PR #1)
- `mvp-schema` ✓ — stores, products, prompts, probe_runs, results, weekly_scores + RLS (PR #2, dev deployed)

## Next (Phase 1)

1. `visibility-api-auth` — **now** (Bearer middleware + `/v1/status` smoke)
2. `visibility-api-crud`
3. weekly probe runner
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
