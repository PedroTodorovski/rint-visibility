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
- **Branch:** `main` (uncommitted: closed storefront must not fail as `shopper_evidence_missing`)
- **Shipped this slice:** loja com senha/bloqueio não aborta o job por prova vazia. Gemini é pulado nessa URL; `track_pdp` / `abrir_senha` sai mesmo sem Shopify ligado. Página aberta + Gemini oco continua falha.
- **Already on main:** recados de Página (`judgePageWeek`, #42). Meta por último (#43). sete recados de Produto. sete recados de Conteúdo.
- **Next:** deploy motor → re-rodar snowboard com senha em produção.

## Repo boundaries

| Repo | Owns |
|------|------|
| **rint-visibility** | API, Supabase `rint.*`, migrations, db-guardrails |
| **rint-app** | D1, UI, proxy |

## Decisions Log

- 2026-08-21: **Grounding decide identidade de objeto citado, não match difuso de nome — agora por objeto, não só por query** — `isCitedClientObject` (`gemini-structured.ts`) e o gêmeo `isClientCitedObject` (`rint-app/src/lib/cited-offer.ts`) só caem no fallback fuzzy de marca/produto quando não há veredito de grounding ou quando esse veredito já confirmou o cliente — nunca quando grounding já disse "não citou". Callers atualizados: `computeTriage` (2 call sites, motor), `hasCitedProductSignal` e `mentionedAttrsFromClientObjects`/`priceMismatchesFromClientObjects`/`crownFromEngineQueries`/`crownCompetitorSku` (rint-app). Segunda rodada, mesmo dia: `GeminiCitedObject`/`CitedObjectLike` ganharam `grounding_confirmed_client?: boolean`, calculado em `mergeCitedObjects` como OR entre o `cliente_foi_citado` de cada execução que contribuiu o objeto — fecha o gap de queries multi-execução (plano "pro", `executionsPerQuery > 1`) onde o voto de maioria da query podia divergir do grounding real de uma execução minoritária. Todo caller agora resolve `object.grounding_confirmed_client ?? query.cliente_foi_citado`. ADR-003 documenta os dois gaps residuais restantes (menores, granularidade por chunk de grounding). Contrato: `rint-app/docs/DIAGNOSIS-DOMINANT.md` § 3.1.
- 2026-08-20: **Porta fechada não espera Gemini** — `password` / `blocked` pulam o probe; job conclui `track_pdp` (`abrir_senha` / `tirar_bloqueio`). Prova vazia só aborta loja aberta/não verificada. Envelope de Página também sem Shopify ligado. Contrato: `rint-app/docs/DIAGNOSIS-DOMINANT.md` § 3.2.
- 2026-08-20: **Juízo da semana (Produto)** — `judgeProductWeek` é regra pura; `product_brief` / `first_action` saem do molde. Sem segundo Gemini. Ouro Nuture = NSF, não preço. Contrato: `rint-app/docs/DIAGNOSIS-DOMINANT.md`.
- 2026-08-20: **0/N e parcial → Conteúdo no job** — `computeTriage` alinha com a tela. `incoherent` e `sourcesWithoutStore` entram no `content_brief`. Cadastro primeiro continua. Contrato: `rint-app/docs/DIAGNOSIS-DOMINANT.md`, `DIAGNOSIS-PREVIEW-SCENARIOS.md`.
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

## Follow-ups (não bloqueantes, retomar quando fizer sentido)

- **Grounding por chunk, não só por execução** — gap residual aceito, detalhado em ADR-003 (seção Consequences): um objeto co-mencionado numa query já `cliente_foi_citado: true` que faz fuzzy-match com o nome do cliente ainda pode ser mal-atribuído. Fechar exigiria correlacionar cada objeto ao host de grounding resolvido específico, não só ao veredito da execução.
- **Cobertura de teste mais fina em caminhos legados/degradados** — dormant workspace `{lacuna, dual_track}` (sem `job`), storefront fechado, `persistEnvelope=false`. Verificado por leitura direta nesta sessão (double-check de 2026-08-21), não por teste dedicado a cada cenário.
