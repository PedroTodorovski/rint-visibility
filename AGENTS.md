# rint-visibility — Agent Entrypoint

Engine API for Rint MVP 2026 — Gemini probes, revenue gap (future), Supabase `rint.*`.

## Owns

- Supabase **`rint` schema** — migrations, db-guardrails, Database Deploy
- Fastify API (Railway)

## Read first

| Task | Doc |
|------|-----|
| Product SSOT | `../rint-app/.planning/MVP-DEFINITION.md` |
| How the engine decides (plain language) | `docs/MAPA-DO-DIAGNOSTICO.md` |
| Probe + object identity (loja / noutro site / ocupante) | `docs/GEMINI-PROBE-METHODOLOGY.md` |
| Citation identity ADR | `.planning/decisions/ADR-003-citation-identity-grounding-precedence.md` |
| Data contract | `../rint-app/docs/architecture/DATA-MINIMALISM-CONTRACT.md` |
| Variable origins | `../rint-app/docs/integrations/VARIABLE-ORIGIN-CONTRACT.md` |
| DB governance | `docs/database/GOVERNANCE.md` |
| Harness | `../rint-app/docs/harness/REVIEW-RINT-VISIBILITY.md` |
| Naming | `../rint-app/docs/harness/RINT-NAMING.md` — Hub is visual example; no Nowle identifiers in source |
| Stack | `../rint-app/docs/harness/STACK.md` |

## Harness commands

When Pedro asks for "comando harness", "comando Harmony", "comando para reviewer", "comando para implementação", "avançar para reviewer", "avançar para implementação", or similar, always read `../rint-app/docs/harness/IMPLEMENTATION-REQUEST-GUIDE.md` and emit the documented copy-paste block for the requested phase.

Do not answer with raw test/build commands unless Pedro explicitly asks for verify commands only. Reviewer handoffs require repo, branch, commit SHA, scope, verify command, verdict options, and expected next output.

## Rules

- **No UI** — JSON API only
- **All `rint.*` SQL here** — ADR-002
- Agents author migrations; Pedro applies Database Deploy
- **Three actors, never mix** — storefront vs same SKU on another host vs occupant. Price 3.1.1 is storefront-only. Storefront **and** reseller in one query: badge Sua loja, second line still names the pharmacy; `isClientProductElsewhereObject` ignores ADR-003 `false` on the reseller. `docs/MAPA-DO-DIAGNOSTICO.md` § 4.1

## Verify

```bash
npm run verify
npm run db:guard   # included in verify; required if migrations changed
```
