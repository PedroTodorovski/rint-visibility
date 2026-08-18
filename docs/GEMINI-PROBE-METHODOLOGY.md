# Gemini Probe Methodology

> Substitui conceitualmente [PROBE-METHODOLOGY.md](./PROBE-METHODOLOGY.md) (superseded). Canônico produto: [MVP-DEFINITION.md](../../rint-app/.planning/MVP-DEFINITION.md).

---

## Motor

**Gemini-only** com **Grounding with Google Search**.

- Usar `groundingChunks` e `groundingSupports` da resposta. Os índices de support pertencem **só** ao primeiro passe (texto do comprador) — não misturar com o JSON. A Prova grifa o `segment.text` e mostra o chip da fonte.
- Não depender de multi-LLM legado no MVP 2026

---

## Pipeline

1. Enviar cluster de prompts de comprador (5–10 por store)
2. Receber resposta **em texto** com grounding metadata
3. Converter para JSON estruturado **pós-resposta** (não pedir JSON direto ao modelo). O segundo passe extrai `objetos_citados[]` — só fatos da resposta + grounding.
4. Extrair citações por domínio/URL. Persistir `web.title` no resolved — no Search grounding isso costuma ser o **domínio**, não o H1.
5. Validar URL antes de contar citação. Storefront do cliente (`identity.domain`) ≠ blog/ajuda no mesmo registrável.
6. Se a resposta nomeia a marca e o storefront não está no texto nem no grounding, **um** follow-up de compra na mesma query — [PROOF-CLIENT-SITE.md](../../rint-app/docs/PROOF-CLIENT-SITE.md).
7. Calcular `citação_cliente` / `citação_concorrente` por cluster de prompts

---

## Validação de URL

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
| `citação_cliente` | prompts onde domínio/brand do cliente aparece em grounding |
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

`objetos_citados` é um **derivado do probe**: um perfil por produto/loja nomeado na resposta citada ou no grounding (preço, dimensões, qualidade, prazo, avaliação, atributos). Campo `null` / `[]` se a IA não disse. Não inventar. Não buscar PDP de concorrente. Não é sync de catálogo. Google Trends permanece `phase_2` e não entra nesse array. Completar o array com 1 follow-up do motor está parked — [CITED-OBJECT-COMPLETION.md](../../rint-app/docs/CITED-OBJECT-COMPLETION.md).

Sem replicar respostas completas do LLM além do necessário para evidência e auditoria.

**Não** tratar o probe como thread de chat. Continuar a conversa no Rint (Interactions API / history) é horizonte parked — [PROOF-CONTINUE-CONVERSATION.md](../../rint-app/docs/PROOF-CONTINUE-CONVERSATION.md). O snapshot do run não se reescreve com um 2º turno do **fundador**. O follow-up do **site do cliente** (1 tiro do motor, mesma query) é MVP — [PROOF-CLIENT-SITE.md](../../rint-app/docs/PROOF-CLIENT-SITE.md).
