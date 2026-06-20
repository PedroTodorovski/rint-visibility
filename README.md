# rint-visibility

Rint MVP 2026 **engine API** — Gemini probes, revenue gap engine (slices futuros).

- **Stack:** Fastify 5, TypeScript, Supabase (`rint` schema)
- **Deploy:** Railway — `https://api.rint.io`
- **No UI** — [`rint-admin`](https://github.com/PedroTodorovski/rint-admin)
- **Migrations SSOT** — this repo (ADR-002)

## Docs

| Doc | Purpose |
|-----|---------|
| [GEMINI-PROBE-METHODOLOGY.md](docs/GEMINI-PROBE-METHODOLOGY.md) | Probe canônico |
| [../rint-admin/.planning/MVP-DEFINITION.md](../rint-admin/.planning/MVP-DEFINITION.md) | Produto |
| [docs/database/GOVERNANCE.md](docs/database/GOVERNANCE.md) | Persistência |

## Verify

```bash
npm run typecheck && npm test && npm run db:guard
```
