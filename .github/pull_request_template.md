## Summary

<!-- What changed and why -->

## Repo

- [ ] `rint-visibility` (engine — api.rint.io, Supabase `rint.*`)

## Verify (local)

- [ ] `npm run verify` (typecheck, tests, db:guard)
- [ ] CI **Quality Gates** job `quality` is green

## Database (Supabase)

- [ ] Migration file added under `supabase/migrations/` (`YYYYMMDDHHMMSS_description.sql`)
- [ ] `npm run db:guard` executed locally
- [ ] Migration metadata: objective, risk, rollback documented in file or PR
- [ ] No historical migration file edited/deleted
- [ ] **Database Deploy** triggered by Pedro only (not agent)

## Harness

- [ ] No UI added to this repo
- [ ] `STATE.md` updated if planning slice moved
- [ ] [REVIEW-RINT-VISIBILITY.md](https://github.com/PedroTodorovski/rint-app/blob/main/docs/harness/REVIEW-RINT-VISIBILITY.md) classification checked
