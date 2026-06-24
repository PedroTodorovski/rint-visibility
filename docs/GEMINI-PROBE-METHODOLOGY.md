# Gemini Probe Methodology

> Substitui conceitualmente [PROBE-METHODOLOGY.md](./PROBE-METHODOLOGY.md) (superseded). Canônico produto: [MVP-DEFINITION.md](../../rint-app/.planning/MVP-DEFINITION.md).

---

## Motor

**Gemini-only** com **Grounding with Google Search**.

- Usar `groundingChunks` e `groundingSupports` da resposta
- Não depender de multi-LLM legado no MVP 2026

---

## Pipeline

1. Enviar cluster de prompts de comprador (5–10 por store)
2. Receber resposta **em texto** com grounding metadata
3. Converter para JSON estruturado **pós-resposta** (não pedir JSON direto ao modelo)
4. Extrair citações por domínio/URL
5. Validar URL antes de contar citação
6. Calcular `citação_cliente` / `citação_concorrente` por cluster de prompts

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

Sem replicar respostas completas do LLM além do necessário para evidência e auditoria.
