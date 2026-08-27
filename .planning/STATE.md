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
- **Branch:** `feat/storefront-coherence-lost-occupant` (base `main`)
- **Shipped this slice:** `incoerente` só com par da vitrine (`coherenceIncident`); ocupante das perdas via `lostOccupantSpeech` (um SKU → nome; dois → several).
- **Already on main:** recados de Página (`judgePageWeek`, #42). Meta por último (#43). sete recados de Produto. sete recados de Conteúdo.
- **Next:** deploy motor → re-rodar snowboard com senha em produção.

## Repo boundaries

| Repo | Owns |
|------|------|
| **rint-visibility** | API, Supabase `rint.*`, migrations, db-guardrails |
| **rint-app** | D1, UI, proxy |

## Decisions Log

- 2026-08-26: **Incoerente só com o par da vitrine** — `computeTriage` grava `coherenceIncident` (said + catalog) e `lost_occupants` / `lost_occupant_speech`. `incoerente` exige o par; farmácia/ML não pinta; Complete Bari vs CompleteBari não é incidente de marca. Occupante das perdas: um SKU → nomeia; dois SKUs → several. Tela: `rint-app` ignora flag antiga. SSOT: [MAPA-DO-DIAGNOSTICO.md](docs/MAPA-DO-DIAGNOSTICO.md) § 6, [GEMINI-PROBE-METHODOLOGY.md](docs/GEMINI-PROBE-METHODOLOGY.md) § Identidade, `rint-app/docs/DIAGNOSIS-DOMINANT.md` § 3.1.
- 2026-08-26: **Três atores no mapa do motor** — sua loja / produto noutro site / ocupante. Preço 3.1.1 só na vitrine; `isClientProductElsewhereObject` não roteia a semana. **Os dois na mesma pergunta:** o helper ignora `grounding_confirmed_client: false` no revendedor (ADR-003 só protege 3.1.1); a Prova ainda nomeia a farmácia. SSOT didático: [MAPA-DO-DIAGNOSTICO.md](docs/MAPA-DO-DIAGNOSTICO.md) § 4.1. Probe: [GEMINI-PROBE-METHODOLOGY.md](docs/GEMINI-PROBE-METHODOLOGY.md) § Identidade. ADR-003. Tela: `rint-app/docs/DIAGNOSIS-DOMINANT.md`.
- 2026-08-26: **Preço 3.1.1 só na vitrine do cliente** — fallback de identidade sem primeira palavra do título Shopify (`citedNameAlignsWithClient`); `computeTriage` não confronta R$ de marketplace/farmácia com o PDP. Fecha o falso “Falou R$ 71” da CompleteBari. ADR-003.
- 2026-08-22: **ADR-003 residual gap fechado — grounding por objeto via `grounding_supports`, revisado em auditoria de 8 ângulos no mesmo dia** — `objectGroundingVerdicts` (`gemini-grounding.ts`) correlaciona todos os objetos citados de uma execução juntos (não um a um isolado), pra que consigam se desambiguar: uma frase de grounding só vira sinal pra um objeto quando nomeia exatamente um deles; frase que nomeia dois objetos ao mesmo tempo (ou uma marca-cliente curta que é prefixo de texto de uma marca-concorrente maior, tipo "Acme" dentro de "Acme Studio") não vira sinal pra nenhum. Confirmado um objeto, os outros de chave diferente na mesma execução viram `false` — não porque a própria frase deles bateu em host diferente (isso incorretamente penalizaria o produto do próprio cliente vendido via marketplace), mas porque já existe uma alternativa específica confirmada. **A primeira versão, publicada mais cedo no mesmo dia, tinha um bug real** (checava cada objeto isolado, sem desambiguação) que a auditoria de revisão pegou antes de eu reportar como concluído — corrigido antes de qualquer deploy. Auditoria também achou e corrigiu: (1) `fillNulls`/`mergeFollowUpCitedObjects` (`cited-offer.ts`) não propagava `grounding_confirmed_client` no merge de follow-up, descartando o veredito recém-calculado; (2) uma **terceira cópia** de `isClientCitedObject`/`crownCompetitorSku`, própria deste repo (`src/lib/cited-offer.ts`, distinta dos gêmeos em `gemini-structured.ts` e `rint-app`), nunca tinha recebido o parâmetro de grounding em nenhuma das suas 4 chamadas — corrigida. Testes: `gemini-grounding.test.ts`, `gemini-structured.test.ts`, `cited-offer.test.ts`, `dominant-diagnostics.test.ts` (inclui teste ponta a ponta com resposta do Gemini mockada real, não campo forçado à mão). Dois riscos residuais documentados e aceitos no ADR-003 (não corrigidos: merge cross-execução pode deixar um `false` fino ser sobrescrito por um fallback grosso de execução irmã sem `grounding_supports`; e as frases correlacionadas vêm de uma chamada Gemini diferente da que gerou os objetos).
- 2026-08-22: **Cobertura de teste dos caminhos legados — revisada, não só lida** — `persistEnvelope=false` já tinha cobertura de comportamento (`"completes on the public PDP floor when Shopify is not connected"`), a nota de 08-21 estava incompleta nesse ponto — não o código. Workspace dormente (`legacyLacunaCreatedAt`) era o gap real e ganhou teste dedicado (`rint-app/src/lib/engine-diagnostics.test.ts`), extraído do `.astro` para `lib/engine-diagnostics.ts`. Loja fechada seguia coberta como já estava.
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
