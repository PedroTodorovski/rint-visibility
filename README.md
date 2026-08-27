# rint-visibility

Rint MVP 2026 **engine API** — Gemini probes, revenue gap engine (slices futuros).

- **Stack:** Fastify 5, TypeScript 6, Supabase (`rint` schema)
- **Toolchain:** [rint-app/docs/harness/STACK.md](../rint-app/docs/harness/STACK.md)
- **Deploy:** Railway — `https://api.rint.io`
- **No UI** — [`rint-app`](https://github.com/PedroTodorovski/rint-app)
- **Migrations SSOT** — this repo (ADR-002)

## Docs

| Doc | Purpose |
|-----|---------|
| [MAPA-DO-DIAGNOSTICO.md](docs/MAPA-DO-DIAGNOSTICO.md) | Mapa didático — do pedido à causa da semana. Inclui os três atores (sua loja / produto noutro site / ocupante) e o caso dos dois na mesma pergunta |
| [GEMINI-PROBE-METHODOLOGY.md](docs/GEMINI-PROBE-METHODOLOGY.md) | Probe canônico + identidade do objeto citado |
| [ADR-003](.planning/decisions/ADR-003-citation-identity-grounding-precedence.md) | Grounding decide “é o cliente?”; preço 3.1.1 só na vitrine |
| [../rint-app/.planning/MVP-DEFINITION.md](../rint-app/.planning/MVP-DEFINITION.md) | Produto |
| [docs/database/GOVERNANCE.md](docs/database/GOVERNANCE.md) | Persistência |

## Verify

**Prerequisites:** Node.js 24+ (see `.nvmrc`).

```bash
npm run verify
```
