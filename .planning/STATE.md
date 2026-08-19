---
gsd_state_version: 1.0
milestone: mvp-2026
status: phase_01_mvp
progress:
  total_phases: 2
  completed_phases: 1
  percent: 95
---

# STATE — rint-visibility

## Current Position

- **Phase:** 1 — MVP 2026 (lacuna de receita)
- **Branch:** `fix/empty-shopper-evidence`
- **Shipped this slice:** Product URL gate — `isLikelyPdpUrl` recusa YouTube / notícia / home / blog / coleção (mesmo denylist do admin). Sem GET. Sem `/products/` obrigatório.
- **Already on main:** Prova vazia falha fechado. Foto do dia. Follow-up de compra só se o **storefront** falta. `objetos_citados`. `first_action` / `content_brief` em `track_llm`. GA4: `sessoesAi` + top-K `sessoesAiLandings` (#31).
- **In flight:** Product URL gate (keep in sync with rint-app `product-url.ts`).
- **Next:** Reviewer verify.

## Repo boundaries

| Repo | Owns |
|------|------|
| **rint-visibility** | API, Supabase `rint.*`, migrations, db-guardrails |
| **rint-app** | D1, UI, proxy |

## Decisions Log

- 2026-08-19: **Porta da URL do produto** — `isLikelyPdpUrl` alinha host+path com rint-app `product-url.ts`. YouTube / notícia / home / blog não entram no Gemini. A loja nasce desse host. Sem GET. VTEX `/p` e slug na raiz passam. Citações da IA (link morto) são outra etapa.
- 2026-08-19: **Prova vazia falha fechado** — execução de provedor habilitado tem texto de comprador visível ou é falha. Quirk Gemini (`thinkingBudget: 0`, teto 8192, parts visíveis) fica no adapter. Foto do dia não reusa oco. ChatGPT/Perplexity no mesmo job depois; sem HTTP neste slice.
- 2026-08-18: **Foto do dia** — par produto+pergunta carimbado no fuso `America/Sao_Paulo`. Mesmo teste no mesmo dia reusa o diagnóstico; pergunta diferente copia o par existente e só o novo vai à web. Sem warehouse. Contrato: `rint-app/.planning/MVP-DEFINITION.md`.
- 2026-08-18: GA4 AI-referral persiste `sessoesAi` e top-K `sessoesAiLandings` (path + sessions) no snapshot. Não é warehouse de pageview. Não escolhe `first_action` / `target_url`. Contrato: `rint-app/docs/architecture/DATA-MINIMALISM-CONTRACT.md`.
- 2026-08-18: Search Console preparado como port pontual `getOwnedSurfaces` (preview simulado no admin; sem OAuth real ainda). O snapshot recebe `ownedSurfaces` e o `content_brief` pode marcar `target_url_source: search_console`.
- 2026-08-18: Superfícies próprias da marca classificadas em `owned_storefront`, `owned_content_directory`, `owned_content_subdomain`, `external_source`. Search Console `domain` cobre subdomínios; `url_prefix` não. `track_llm` cria URL editorial nova ou melhora URL própria existente. Contrato: `rint-app/docs/DIAGNOSIS-DOMINANT.md`.
- 2026-08-18: `track_llm` `next_steps.first_action` + `content_brief` formulados das N queries + attrs próprios não usados + skip do ocupante + superfície/URL. Não cola `query_text[0]`. `src/services/llm-out-first-action.ts`. Contrato: `rint-app/docs/DIAGNOSIS-DOMINANT.md`.
- 2026-08-17: Follow-up do site do cliente: `hostIsClientStorefront` (exact host). Log `client_site_follow_up`. SSOT admin: `rint-app/docs/PROOF-CLIENT-SITE.md`.
- 2026-08-17: `GET /v1/jobs` devolve resumo compacto (`sku_names`, `cliente_foi_citado`, `providers` no snapshot) para a lista em rint-app. Sem secrets. Jobs antigos inferem Shopify do snapshot quando dá.
- 2026-08-17: Queries Gemini no job dominante correm em paralelo limitado (`DIAGNOSTIC_QUERY_CONCURRENCY`, default 3). Lock BullMQ 30 min. Produção exige Redis + worker.
- 2026-08-16: Completar `objetos_citados` com 1 follow-up do motor está parked — `rint-app/docs/CITED-OBJECT-COMPLETION.md`. Array incompleto permanece válido.
- 2026-08-16: `objetos_citados` no `gemini_structured` (jsonb) — perfil do objeto citado no segundo passe. Sem migration. Sem sync de catálogo. Triage LLM só compara preço/atributos quando o objeto é o SKU do cliente.
- 2026-06-27: Prompts per-SKU (`product_id`) — wizard diagnóstico MVP
- 2026-06-20: MVP 2026 engine slices implemented — Gemini-only probe, ports + cache, lacuna C1/C2 snapshots, dual-track outputs
- 2026-06-19: MVP 2026 pivot — Gemini-only, lacuna C1+C2, dual-track, data minimalism
- 2026-06-17: ADR-002 — migrations here only

## Blockers

- Migration `20260627120000_prompts_product_id.sql` authored — **Pedro deploy only**
