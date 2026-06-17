# Database Governance

This document defines non-negotiable governance rules for **Rint product data** in Supabase.

**SSOT:** This repository (`rint-visibility`) owns the `rint` schema, migrations, and deploy workflows.

**Not here:** `rint-admin` owns Cloudflare D1 (auth, billing, CMS) only — see [rint-admin](https://github.com/PedroTodorovski/rint-admin).

## Scope

- Applies to all database changes for Supabase environments: `dev` and `prod`.
- Applies to engineers, AI agents, external contributors, and automation.
- Product v1 data lives in the `rint` schema in Supabase; **this repo** authors migrations and runs deploy CI.
- Admin auth/billing/CMS live in Cloudflare D1 (`rint-admin`) — out of scope for this document.

## Principles

1. Production data is the primary asset and must be protected by process and automation.
2. Every schema change must be versioned as SQL migration in this repository.
3. No manual schema edits in Supabase production dashboard.
4. Least privilege by default for people, bots, and CI tokens.
5. RLS and policies are part of schema ownership, not post-work.
6. Every high-risk operation must be auditable and reversible.

## Environment Separation

- `dev`: unrestricted experimentation (still migration-based).
- `prod`: guarded by explicit approvals and restricted credentials.

Required setup in Supabase and GitHub:

- Two Supabase projects with strict access controls (`dev` and `prod`).
- Production service credentials available only in GitHub protected environment `prod`.
- Local machines must not store production database passwords or service-role keys.

## Access Control

- Humans and AI must create migrations only through pull requests.
- Direct `psql`, SQL editor, or dashboard schema edits in production are forbidden.
- Service-role keys are server-only and never allowed in browser/client bundles.
- Production deploy workflow must require manual approval from designated owners.

## Mandatory Controls

- Branch protection for `main` (PR required, status checks required, no force push).
- CODEOWNERS protection for:
  - `supabase/migrations/**`
  - `docs/database/**`
  - `.github/workflows/db-*.yml`
  - `scripts/db/**`
- CI guardrails must block:
  - destructive SQL statements without explicit override marker
  - unsafe `UPDATE`/`DELETE` without `WHERE`
  - edits/deletes of historical migration files

## Forbidden Actions

The following actions are prohibited by default:

- `DROP TABLE`, `DROP SCHEMA`, `TRUNCATE`
- non-scoped `UPDATE` or `DELETE`
- changing old migration files already merged in `main`
- running migration deploy against production from local machine

If a destructive change is unavoidable:

- use a dedicated RFC/ticket
- include explicit override markers in migration SQL (`-- rint:allow-destructive <ticket-id>`)
- require two senior approvals plus rollback plan
- execute only during approved maintenance window

## Audit and Traceability

Each migration PR must include:

- objective and business reason
- risk class (`low`, `medium`, `high`)
- rollback strategy
- data impact summary
- link to runbook/checklist used

## AI-Specific Rules

AI agents may:

- generate migration SQL files
- generate docs and runbooks
- run static checks and tests

AI agents may not:

- execute production migrations
- bypass branch protection or required approvals
- perform manual production data edits
- disable CI guardrails

## Ownership

- Platform/Data owner: accountable for production database safety.
- Feature owner: accountable for migration correctness and validation.
- Reviewer owner: accountable for policy, RLS, and rollback quality.
