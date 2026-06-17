# rint-visibility — Agent Entrypoint

Engine-only microservice for Rint v1 AI visibility (probes, scores, catalog fixes).

## Stack

- Fastify 5, TypeScript, Node 22+
- Supabase `rint` schema (migrations in **rint-admin** only)
- Railway deploy (separate project from other Rint modules)

## Read first

| Task | Doc |
|------|-----|
| Product SSOT | `../rint-admin/.planning/PROJECT.md` |
| Session state | `../rint-admin/.planning/STATE.md` |
| Harness | `../rint-admin/docs/harness/README.md` |
| DB governance | `../rint-admin/docs/database/GOVERNANCE.md` |

## Rules

- **No UI** — JSON API only
- **No SQL migrations here** — author in `rint-admin/supabase/migrations/`
- **No production DB writes from local** — deploy via rint-admin GitHub Actions
- GitHub account: **PedroTodorovski** (not PedroTodorovskiNowle)

## Verify before handoff

```bash
npm run typecheck && npm test
```

## Port

Default local: `3010`. Railway sets `PORT` automatically.
