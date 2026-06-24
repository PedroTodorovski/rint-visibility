# rint-visibility

Rint MVP 2026 **engine API** — Gemini probes, revenue gap engine (slices futuros).

- **Stack:** Fastify 5, TypeScript, Supabase (`rint` schema)
- **Deploy:** Railway — `https://api.rint.io`
- **No UI** — [`rint-app`](https://github.com/PedroTodorovski/rint-app)
- **Migrations SSOT** — this repo (ADR-002)

## Docs

| Doc | Purpose |
|-----|---------|
| [GEMINI-PROBE-METHODOLOGY.md](docs/GEMINI-PROBE-METHODOLOGY.md) | Probe canônico |
| [../rint-app/.planning/MVP-DEFINITION.md](../rint-app/.planning/MVP-DEFINITION.md) | Produto |
| [docs/database/GOVERNANCE.md](docs/database/GOVERNANCE.md) | Persistência |

## Verify

**Prerequisites:** Node.js 24+ (see `.nvmrc`), Python 3.12+ (see `.python-version`).

```bash
npm run typecheck && npm test && npm run db:guard
```
