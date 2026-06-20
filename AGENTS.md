# rint-visibility — Agent Entrypoint

Engine API for Rint MVP 2026 — Gemini probes, revenue gap (future), Supabase `rint.*`.

## Owns

- Supabase **`rint` schema** — migrations, db-guardrails, Database Deploy
- Fastify API (Railway)

## Read first

| Task | Doc |
|------|-----|
| Product SSOT | `../rint-admin/.planning/MVP-DEFINITION.md` |
| Probe | `docs/GEMINI-PROBE-METHODOLOGY.md` |
| Data contract | `../rint-admin/docs/architecture/DATA-MINIMALISM-CONTRACT.md` |
| Variable origins | `../rint-admin/docs/integrations/VARIABLE-ORIGIN-CONTRACT.md` |
| DB governance | `docs/database/GOVERNANCE.md` |
| Harness | `../rint-admin/docs/harness/REVIEW-RINT-VISIBILITY.md` |

## Rules

- **No UI** — JSON API only
- **All `rint.*` SQL here** — ADR-002
- Agents author migrations; Pedro applies Database Deploy

## Verify

```bash
npm run typecheck && npm test
npm run db:guard   # if migrations changed
```
