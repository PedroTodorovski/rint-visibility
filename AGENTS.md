# rint-visibility — Agent Entrypoint

Engine-only microservice for Rint v1 AI visibility (probes, scores, catalog fixes).

## Owns

- Supabase **`rint` schema** — `supabase/migrations/`, `scripts/db/`, `Database Deploy` CI
- Fastify API (Railway, separate project)

## Does not own

- Admin UI → **`rint-admin`**
- D1 auth/billing/CMS → **`rint-admin`**
- SQL migrations for product data in any other repo

## Read first

| Task | Doc |
|------|-----|
| Product SSOT | `../rint-admin/.planning/PROJECT.md` |
| Phase 1 plan | `../rint-admin/.planning/phases/01-mvp-v1/PLAN.md` |
| Migration ownership ADR | `.planning/decisions/ADR-002-migration-ownership.md` |
| DB governance | `docs/database/GOVERNANCE.md` |
| Deploy secrets + git | `../rint-admin/docs/harness/GIT-WORKFLOW.md` |
| Harness | `../rint-admin/docs/harness/README.md` |

## Rules

- **No UI** — JSON API only
- **All `rint.*` SQL here** — never in rint-admin
- **No production DB writes from local** — deploy via GitHub Actions `Database Deploy`
- GitHub: **PedroTodorovski**

## Verify before handoff

```bash
npm run typecheck && npm test
npm run db:guard   # if migrations changed
```

## Port

Default local: `3010`. Railway sets `PORT`.
