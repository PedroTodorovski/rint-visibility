# Migration Workflow

This workflow is mandatory for all Rint v1 schema and policy changes.

## Folder Convention

- All migrations live in `supabase/migrations/`.
- File name format: `YYYYMMDDHHMMSS_description.sql`.
- Migration files are immutable after merge to `main`.

## Workflow Stages

1. Author migration in feature branch.
2. Run local checks:
   - `npm run db:guard`
   - `npm run typecheck`
   - `npm run test`
3. Open PR with migration context:
   - objective
   - risk level
   - rollback strategy
   - data impact
   - evidence of local checks
4. Required reviews (CODEOWNERS + feature reviewer).
5. CI must pass migration guardrails.
6. Merge to `main`.
7. **Pedro** applies migrations via GitHub Actions **Database Deploy** on **this repo**:
   - first on `dev`
   - then on `prod` after approval

> **Agents:** author SQL and open PRs only. Do not trigger **Database Deploy** or run `supabase db push` / remote SQL. See `docs/database/GOVERNANCE.md` (AI-Specific Rules).

## Workflow Runtime

Database GitHub Actions must stay on runtime versions that GitHub currently supports:

- `actions/checkout@v6`
- `actions/setup-node@v6`
- Node.js `24` for jobs that run project scripts
- `supabase/setup-cli@v2` with a pinned `SUPABASE_CLI_VERSION`

## SQL Requirements

- Include schema, RLS, policies, indexes, and grants in migration itself.
- Prefer additive migrations over destructive replacements.
- Any destructive SQL requires explicit marker:
  - `-- rint:allow-destructive <ticket-id>`
- Production migration jobs should use a GitHub Actions-reachable connection. Prefer the Session pooler on port 5432; direct `db.*.supabase.co` hosts often resolve to IPv6 and fail on GitHub-hosted runners.

## Release Rules

- `prod` migration deploy must run only from `main`.
- `prod` deploy must use GitHub protected environment with required approvers.
- No local production migration execution.
- For `prod` deploys, pipeline runs `dev -> prod` in sequence.
- If the `dev` database is unavailable because of a Supabase connectivity incident, `skip_dev_gate` may be used only with an explicit `skip_dev_gate_reason`. Prefer `dry_run=true` first, then run `dry_run=false` only after the production dry-run succeeds and the approver accepts the bypass.

## GitHub Environment Contract

**Repository:** `PedroTodorovski/rint-visibility` only (ADR-002). Do not configure Supabase deploy secrets on `rint-admin`.

Configure protected environments: `dev` and `prod` (`Settings → Environments`).

**Default branch must be `main`.** `workflow_dispatch` workflows (Database Deploy) are registered from the default branch; if the repo default is another branch, the workflow will not appear in Actions.

Each environment must define:

| Secret | Required | Notes |
|--------|----------|-------|
| `SUPABASE_ACCESS_TOKEN` | Yes | [Account tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF` | Yes | Project ref from dashboard URL (`supabase.com/project/XXXX`) |
| `SUPABASE_DB_PASSWORD` | Yes | **Database password** from Project Settings → Database — not anon/service_role |
| `SUPABASE_DB_URL` | Optional | Omit for `dev` (recommended); CI resolves Session pooler via Management API |

When copying secrets between repos, re-type `SUPABASE_DB_PASSWORD` manually. Paste/placeholder errors show as `password authentication failed (28P01)` or `postgres.[SEU-PROJECT-REF] not found`.

`dev` and the production dev gate resolve a migration-safe database URL before running `supabase db push`. If `SUPABASE_DB_URL` is set, it must be either the Session pooler URL on port 5432 or a direct database URL. Direct `db.*.supabase.co` URLs are auto-upgraded to the Session pooler via the Supabase Management API because GitHub Actions cannot reach IPv6-only direct hosts. When the API returns only transaction pooler metadata (port 6543), the resolver uses the same pooler host on port 5432 (Session mode). Transaction pooler URLs on port 6543 are rewritten to port 5432 automatically.

`prod` uses the same resolver before remote history hydration and the actual push. Prefer the Session pooler URL on port 5432 in `SUPABASE_DB_URL`; direct database URLs are auto-upgraded when needed. Keep `prod` protected with required reviewers before job execution.

## Production Promotion

For a production deploy:

1. Merge the migration PR to `main`.
2. Run `Database Deploy` with `target_env=prod` and `dry_run=true`.
3. Review both the dev gate and production dry-run logs.
4. Confirm the `prod` environment has a direct `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, and `SUPABASE_PROJECT_REF`.
5. After approval, rerun `Database Deploy` with `target_env=prod` and `dry_run=false`.

## Rollback Policy

- Every migration PR must include rollback notes.
- Rollback can be:
  - logical rollback migration
  - restore from PITR snapshot (for severe incidents)
