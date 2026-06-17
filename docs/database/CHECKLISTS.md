# Database Checklists

**Repo:** `rint-visibility` only. Do not run these checklists for Supabase work in `rint-admin`.

## Pre-Flight Checklist (Local)

- [ ] Changes are only in `supabase/migrations/` for schema evolution.
- [ ] No historical migration was edited/deleted.
- [ ] New migration names follow `YYYYMMDDHHMMSS_description.sql`.
- [ ] `npm run db:guard` executed successfully.
- [ ] `npm run typecheck` executed successfully.
- [ ] `npm run test` executed successfully.
- [ ] Destructive SQL has explicit marker `-- rint:allow-destructive <ticket-id>` and explicit approval.

## PR Checklist (Migration)

- [ ] Migration file created in `supabase/migrations/`.
- [ ] File name follows timestamp convention.
- [ ] Migration metadata includes `objective`, `risk`, and `rollback`.
- [ ] Migration is additive or includes approved destructive marker.
- [ ] RLS/policies included when new tables are introduced.
- [ ] Backfill/data migration is idempotent or safe for re-execution.
- [ ] App/schema contract is coherent (enums/columns/constraints used by API/UI).
- [ ] Risk level section documented in PR.
- [ ] Rollback notes included in PR description.
- [ ] Data impact described (tables + estimated rows).
- [ ] Evidence attached for `db:guard`, `typecheck`, and `test`.
- [ ] CODEOWNERS + feature reviewer requested.
- [ ] CI is green.

## Gate Checklist (Dev Before Prod)

- [ ] Migrations applied in `dev` via **Database Deploy** on **this repo**.
- [ ] `Database Deploy` (`target_env=dev`) passed with `dry_run=true` before `dry_run=false`.
- [ ] Secrets live on **rint-visibility** GitHub environment `dev` (not rint-admin).
- [ ] Smoke checks executed for impacted modules.
- [ ] Data integrity spot-check executed.
- [ ] Evidence linked in PR/ticket.
- [ ] If `dev` validation fails, promotion to `prod` is blocked.

## Pre-Prod Governance Checklist

- [ ] Backup/PITR confirmed healthy.
- [ ] Deploy window validated and owner/on-call aware.
- [ ] Production deploy source is `main`.
- [ ] Protected environment approval for `prod` is in place.
- [ ] `prod` GitHub environment on **rint-visibility** has `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, and `SUPABASE_DB_PASSWORD` (optional `SUPABASE_DB_URL`).
- [ ] Production dry-run pending migration list was reviewed before approval.

## Deploy Prod Checklist (Pipeline)

- [ ] Official workflow executed in sequence `dev -> prod`.
- [ ] `Database Deploy` was run first with `target_env=prod` and `dry_run=true`.
- [ ] `Database Deploy` was rerun with `target_env=prod` and `dry_run=false` only after approval.
- [ ] No manual SQL execution in dashboard/local terminal.
- [ ] Execution logs monitored until full completion.
- [ ] Rollback plan executed immediately if partial failure occurs.

## Post-Deploy Checklist

- [ ] Migration command succeeded with expected files.
- [ ] App smoke checks passed.
- [ ] Data integrity spot checks passed.
- [ ] No unexpected lock/performance regressions.
- [ ] Final result, timestamp, and evidence linked in PR/ticket.
