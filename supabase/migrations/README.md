# Supabase Migrations

This directory is the source of truth for Rint v1 product schema evolution.

## Rules

- Add new migrations only. Do not edit old migrations after merge.
- Use file naming: `YYYYMMDDHHMMSS_description.sql`.
- Keep SQL idempotent when possible.
- Include metadata header on each new migration:
  - `-- rint:migration`
  - `-- objective: <what this migration changes>`
  - `-- risk: <low|medium|high>`
  - `-- rollback: <how to revert safely>`
- Include RLS/policy changes in the same migration that creates related tables.
- Any destructive SQL must include explicit marker:
  - `-- rint:allow-destructive <ticket-id>`

## Commands

- `npm run db:guard`
- `npm run db:guard:history` (CI only; requires `BASE_REF`)

## Reference Docs

- `docs/database/GOVERNANCE.md`
- `docs/database/MIGRATION_WORKFLOW.md`
- `docs/database/CHECKLISTS.md`
