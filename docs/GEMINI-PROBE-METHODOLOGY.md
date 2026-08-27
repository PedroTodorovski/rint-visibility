# Gemini Probe Methodology

> Substitui conceitualmente [PROBE-METHODOLOGY.md](./PROBE-METHODOLOGY.md) (superseded). Canônico produto: [MVP-DEFINITION.md](../../rint-app/.planning/MVP-DEFINITION.md).

---

## Motor

**Gemini-only** com **Grounding with Google Search**.

- Usar `groundingChunks` e `groundingSupports` da resposta. Os índices de support pertencem **só** ao primeiro passe (texto do comprador) — não misturar com o JSON. A Prova mostra o chip da fonte no span; só grifa trecho curto. Frase inteira grounded não vira caixa cinza.
- Não depender de multi-LLM legado no MVP 2026
- `essential` / `pro` no job de diagnóstico é **profundidade do probe** (1 vs 3 execuções/query), não o plano comercial. O MVP manda sempre o padrão (`essential`). Cota de diagnósticos no período (alavanca A) vive no app. Contrato: [BILLING-CONTRACT.md](../../rint-app/docs/architecture/BILLING-CONTRACT.md).

---

## URL do SKU (porta — antes do probe)

A loja (`identity.domain`) nasce do host da URL que o fundador colou. Por isso o wizard e o `isLikelyPdpUrl` recusam home, vídeo, notícia, blog e coleção **antes** de chamar o Gemini: senão o YouTube vira a loja. Mesma regra no admin (`rint-app` `src/lib/ui/product-url.ts`) e no engine. Comparação de string; sem GET. Não exige `/products/` (VTEX `/slug/p`, Nuvemshop `/produtos/`, slug na raiz). Mercado Livre e Amazon passam. Listas vivem no código — não copiar aqui.

Isto **não** é a secção de validação de URL mais abaixo. Lá a gente olha os **links que a IA citou depois da resposta** (vitrine vs blog; link morto).

## Pipeline

1. Enviar cluster de prompts de comprador (5–10 por store)
2. Receber resposta **em texto** com grounding metadata
3. Converter para JSON estruturado **pós-resposta** (não pedir JSON direto ao modelo). O segundo passe extrai `objetos_citados[]` — só fatos da resposta + grounding.
4. Extrair citações por domínio/URL. Persistir `web.title` no resolved — no Search grounding isso costuma ser o **domínio**, não o H1.
5. Validar URL antes de contar citação. Storefront do cliente (`identity.domain`) ≠ blog/ajuda no mesmo registrável.
6. Se a resposta nomeia a marca e o storefront não está no texto nem no grounding, **um** follow-up de compra na mesma query — [PROOF-CLIENT-SITE.md](../../rint-app/docs/PROOF-CLIENT-SITE.md).
7. Classificar cada `objeto_citado`: vitrine do cliente, mesmo SKU noutro host, ou ocupante. Ver § Identidade abaixo. Preço 3.1.1 **e** marca 3.1.3 **só** na vitrine. `incoerente` só com o par nomeável.
8. Calcular `citação_cliente` / `citação_concorrente` por cluster de prompts
9. **Foto do dia** — se o mesmo produto + a mesma pergunta (maiúscula/espaço/acento ignorados) já tem evidência completed hoje (`America/Sao_Paulo`), **não** buscar de novo. Copiar a evidência e o horário em que foi medida. Se o conjunto inteiro de URLs+perguntas for idêntico a um job completed hoje, devolver esse job — não enfileirar. Uma pergunta diferente = job novo; só o par novo vai à web. Citação continua só com o link da loja nas fontes — menção no texto não conta. Linha no tempo é evolução. Canônico: [MVP-DEFINITION.md](../../rint-app/.planning/MVP-DEFINITION.md).

---

## Identidade do objeto citado — três atores

Didático: [MAPA-DO-DIAGNOSTICO.md](./MAPA-DO-DIAGNOSTICO.md) § 4.1. Tela: [DIAGNOSIS-DOMINANT.md](../../rint-app/docs/DIAGNOSIS-DOMINANT.md) § Três atores. Decisão: [ADR-003](../.planning/decisions/ADR-003-citation-identity-grounding-precedence.md).

O segundo passe persiste **todo** `objetos_citados[]` daquela query (derivado do probe — sem warehouse de farmácia/marketplace). Cada objeto é **um** destes. Nunca misturar.

| O que o grounding / o JSON mostrou | Papel | Helper (`src/lib/cited-offer.ts`) |
|---|---|---|
| Host da URL que o fundador colou (`identity.domain` / PDP) | **Sua loja** | `isClientStorefrontObject` |
| Mesma marca/SKU, **outro** host (Raia, Mercado Livre, Pague Menos) | **Seu produto em outro site** | `isClientProductElsewhereObject` |
| **Os dois** na mesma query | Selo **Sua loja** + fato da farmácia | Os dois helpers. Elsewhere **não** some se o ADR-003 marcou o revendedor `grounding_confirmed_client: false` |
| Outra marca | **Ocupante** | não é cliente: `!isCitedClientObject` |

Gêmeos no admin: `rint-app/src/lib/cited-offer.ts`. A Prova escreve o selo e o fato; o motor **não** escolhe a semana por canal de venda.

Regras inegociáveis:

1. **`cliente_foi_citado` (query)** — `citation-gold.ts`: só o **storefront** no grounding. Blog/ajuda no mesmo registrável não conta. Texto da marca sem o host da vitrine não conta (dispara o follow-up de compra).
2. **`isCitedClientObject` (objeto)** — host da vitrine primeiro; fallback de nome só com `citedNameAlignsWithClient` (`compactIdentity`, Complete Bari = CompleteBari). **Não** a primeira palavra do título Shopify (`Multivitamínico …`). Grounding `false` veta o fallback. Veredito **por objeto** (`grounding_confirmed_client`) antes do voto da query.
3. **Preço 3.1.1 e marca 3.1.3** — `computeTriage` só confronta `objeto.preco` / `marca` com o cadastro quando `isClientStorefrontObject`. R$ na prateleira da farmácia **não** é `incoerente`. Não pinta o lime “preço errado”. Não é 5ª track. `incoerente` **só** se o run consegue nomear o par (persiste `coherence_incident` em `checks`). Flag antiga sozinha não pinta.
4. **Os dois na mesma query** — vitrine nas fontes **e** o SKU na Raia/Drogasil. `cliente_foi_citado` continua true. `isClientProductElsewhereObject` **não** some porque o ADR-003 marcou o objeto da farmácia `grounding_confirmed_client: false` (isso só protege o 3.1.1 / 3.1.3). A Prova: selo Sua loja + “Também mandou comprar na {loja}”.
5. **Ocupante** — objeto que não é o cliente. Alimenta `track_produto` quando N/N + rua ok. Não escrever atributo só do ocupante no Shopify. A linha do mosaico (“nas outras 2, apontou”) usa `occupantsFromLostQueries` / `lostOccupantSpeech` — quem levou **cada pergunta perdida**, não a coroa da aba Produto. Um SKU em todas as perdas → um nome. Dois SKUs → “outros produtos”, sem eleger um.
6. **Data minimalism** — não catalogar revendedores autorizados. O fato “mandou comprar na Raia” nasce desta rodada.

Testes: `tests/cited-offer.test.ts`, `tests/gemini-structured.test.ts`, `tests/dominant-diagnostics.test.ts`.

---

## Validação de URL (citações, depois da resposta)

Não confundir com a porta da URL do SKU acima. Aqui o job já rodou; o alvo é cada link no grounding.

1. Extrair URL de grounding metadata
2. Verificar HTTP status (2xx/3xx) com timeout
3. URL morta → `why_code: url_dead` — não conta como citação válida
4. Registrar evidência para UI accordion

---

## Paridade dev API vs gemini.google.com

Protocolo obrigatório antes de release:

1. Mesmo prompt em API e app web
2. Comparar domínios citados (não só texto livre)
3. Divergência > threshold → flag `parity_drift` no run metadata
4. Documentar versão do modelo e região

---

## Métricas

| Métrica | Definição |
|---------|-----------|
| `citação_cliente` | prompts onde o **storefront** (host da URL colada) aparece no grounding — não basta a marca no texto, nem o SKU noutro site |
| `citação_concorrente` | prompts onde concorrente configurado aparece |
| Ratio | usado na fórmula Lacuna_R$ — ver [REVENUE-MODEL.md](../../rint-app/docs/REVENUE-MODEL.md) |

Não usar apenas X/Y genérico sem contexto de cluster SKU.

---

## why_code / layers (UI)

Manter tabela de `why_code` para accordion de evidência (foundation trust-layer):

| Code | Significado |
|------|-------------|
| `competitor_cited` | Concorrente citado, cliente não |
| `client_cited` | Cliente citado |
| `generic_answer` | Resposta sem marca específica |
| `url_dead` | URL de citação inválida |
| `parity_drift` | Divergência API vs app |
| `pdp_missing` | PDP do cliente ausente na citação |

---

## Persistência

- `probe_runs` — metadata do run (modelo, timestamps, flags)
- `results` — por prompt × citação × why_code
- Derivados: `lacuna_snapshots` (slice futuro)
- `diagnostic_queries.gemini_structured` — JSON do segundo passe, incluindo `objetos_citados[]`

`objetos_citados` é um **derivado do probe**: um perfil por produto/loja nomeado na resposta citada ou no grounding (preço, dimensões, qualidade, prazo, avaliação, `imagem_url`, atributos). Campo `null` / `[]` se a IA não disse. Não inventar. Não é sync de catálogo. Google Trends permanece `phase_2` e não entra nesse array.

Oferta do checkout citado: o port `OfferReader` devolve um `ShopperOffer` **de uma PDP**. Listagem, ranking e “onde comprar” que caem em corredor de farmácia **não** são oferta. Se o probe só nomeou o SKU (grounding de blog/ranking, `url` null), `planCitedFaceFollowUp` pede o link da loja — 1 tiro **silencioso** por face da vs, inclusive no empate. Esse tiro **não** aparece como continuação de conversa no mosaico. `readCitedOffer` resolve essa URL, recusa home/blog/login/`refuseCitedOffer`, e `stampCitedShopperFacts({ fromCheckout: true })` grava os fatos **dessa** página (preço de blog não sobrevive). GET falhou → a URL some da face. JSON da plataforma + HTML **da mesma URL**. Persiste **só derivados** em `objetos_citados`. Sem `twitter:image`. Sem warehouse. [CITED-OBJECT-COMPLETION.md](../../rint-app/docs/CITED-OBJECT-COMPLETION.md).

Sem replicar respostas completas do LLM além do necessário para evidência e auditoria.

**Não** tratar o probe como thread de chat. Continuar a conversa no Rint (Interactions API / history) é horizonte parked — [PROOF-CONTINUE-CONVERSATION.md](../../rint-app/docs/PROOF-CONTINUE-CONVERSATION.md). O snapshot do run não se reescreve com um 2º turno do **fundador**. O follow-up do **site do cliente** (1 tiro do motor, mesma query) é MVP e **pode** virar bolha na Prova — [PROOF-CLIENT-SITE.md](../../rint-app/docs/PROOF-CLIENT-SITE.md). O follow-up de **completar a vs** não vira bolha. Não acrescentar um terceiro tiro “qual você recomenda comprar?” quando as N perguntas já foram de intenção de compra e a rua só devolveu listagem: a vs vazia **é** o diagnóstico.
