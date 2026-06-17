---
gsd_state_version: 1.0
milestone: v1.0
status: phase_01_mvp
---

# STATE — rint-visibility

## Role

Engine API for Rint v1 AI visibility. **Owns Supabase `rint` schema** (migrations + deploy CI).

## Current slice

`mvp-schema` — migration ready on `feat/mvp-schema` (deploy after merge)

## Completed

- `db-ownership` ✓ — Supabase CI migrated from rint-admin (ADR-002, PR #1)
- Default branch set to `main` (required for Database Deploy in Actions UI)
- Railway + `visibility.rint.io` + `VISIBILITY_API_KEY`
- `.env.local` with Supabase dev credentials

## Next (Phase 1)

1. `mvp-schema` — **now**
2. `visibility-api-auth`
3. `visibility-api-crud`
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
