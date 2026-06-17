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
- **No production DB writes from local** — Pedro applies migrations via GitHub Actions **Database Deploy** on **this repo** only
- **Agents author migrations only** — they may add files under `supabase/migrations/` and run `npm run db:guard`; they must **not** run `supabase db push`, Management API SQL, or trigger **Database Deploy**
- GitHub: **PedroTodorovski**

## Migrations (standard)

Product schema SQL lives in `supabase/migrations/` with the usual headers (`-- rint:migration`, objective, risk, rollback). Example: `20260617180000_expose_rint_postgrest_schema.sql` exposes the `rint` schema to PostgREST — same pattern as other engine repos, not a special one-off.

**Apply (Pedro only):** merge to `main` → Actions → **Database Deploy** → `target_env=dev`, `dry_run=true` first, then `dry_run=false`. See `docs/database/MIGRATION_WORKFLOW.md`.

## Verify before handoff

```bash
npm run typecheck && npm test
npm run db:guard   # if migrations changed
```

## Port

Default local: `3010`. Railway sets `PORT`.
