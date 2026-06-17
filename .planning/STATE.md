---
gsd_state_version: 1.0
milestone: v1.0
status: phase_01_mvp
---

# STATE — rint-visibility

## Role

Engine API for Rint v1 AI visibility. **Owns Supabase `rint` schema** (migrations + deploy CI).

## Current slice

`db-ownership` — migrate Supabase CI from rint-admin → this repo

## Next (Phase 1)

1. `db-ownership` ✓ (this PR)
2. `mvp-schema` — product tables
3. `visibility-api-auth`
4. … see `../rint-admin/.planning/phases/01-mvp-v1/PLAN.md`

## Verify

```bash
npm run typecheck && npm test && npm run db:guard
```

## GitHub

Account: **PedroTodorovski** | Deploy: Railway (separate project)
