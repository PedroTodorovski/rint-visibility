# Probe methodology — web-grounded visibility

## Product principle

Shoppers configure **buyer prompts** (e.g. *"Sofá em caixa pela internet"*). They do **not** need to ask for web search explicitly.

**Rint's job** is to run every probe as a **web-grounded** AI answer — the same class of result users get from Claude/ChatGPT with search enabled. We wrap each prompt, enable the provider's search tool, and score citations from live-grounded text.

## What we measure

For each buyer prompt:

1. Send the prompt through Rint's **probe envelope** (search required, Brazil market, name brands + URLs).
2. Call Claude with **`web_search_20250305`** (always on — not configurable).
3. Run `detectCitation()` on the answer vs store domain / catalog URLs / brand name.

**X/Y** = slots where the store was cited / total active prompts.

## Citation signals

| Signal | Meaning |
|--------|---------|
| `domain_match` | URL host matches store domain |
| `url_match` | Catalog product URL (PDP) |
| `domain_text_match` | Domain string in prose |
| `brand_match` | Full store name (Unicode-safe) |
| `brand_token_match` | Primary token (e.g. "Inflow" for "Inflow Sofá") |

## Citation layers (UI)

| Layer | Derived from |
|-------|----------------|
| `product` | `url_match` |
| `domain` | `domain_match` or `domain_text_match` |
| `brand` | `brand_match` or `brand_token_match` |

## Why codes (metadata v2)

Human copy is rendered in admin i18n — codes are never shown to users.

| Code | When |
|------|------|
| `cited_pdp` | Product URL cited |
| `cited_domain` | Store domain cited (not PDP) |
| `cited_brand` | Brand name cited |
| `uncited_competitor` | Response mentions other brands/URLs |
| `uncited_generic` | Generic category answer |
| `uncited_prompt_mismatch` | Prompt is generic; doesn't target the store |
| `uncited_no_mention` | Store absent from grounded answer |

## Result metadata v2

Each `results.metadata` row includes:

| Field | Type | Purpose |
|-------|------|---------|
| `match_signals` | `string[]` | Citation signals |
| `matched_url` | `string \| null` | Best URL matched |
| `provider_model` | `string` | Claude model id |
| `mocked` | `boolean` | Simulated response |
| `web_search` | `boolean` | Search tool used |
| `citation_layer` | `product \| domain \| brand \| none` | Layer for UI |
| `why_code` | see above | Explanation key |
| `highlight_spans` | `{ start, end, kind }[]` | Offsets in `response_excerpt` |
| `competitors` | `{ name, url?, type }[]` | Other brands/domains mentioned |

## History & compare API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/probe-runs` | List runs with citation counts |
| `GET` | `/v1/probe-runs/:id/results` | Stable results for one run |
| `GET` | `/v1/probe-runs/compare?from=&to=` | Delta cited + per-prompt flips |
| `GET` | `/v1/results?probe_run_id=` | Filter flat results by run |

## Example — Inflow Sofá (validation)

- 10 prompts, Claude + web search
- Typical outcome: **3/10** cited via `domain_text_match` → `cited_domain`
- **0/3** PDP (`url_match`) when catalog URLs not cited
- Generic prompts (e.g. *"Sofá em caixa pela internet"*) → `uncited_competitor` when competitors named

## Limits

- Requires `ANTHROPIC_API_KEY` + web search enabled on the Anthropic org.
- ~$10 / 1k searches + tokens; N prompts ≈ N searches (batch).
- If the model answers without searching, `web_search: false` on that slot — visible in admin meta.
- Competitor detection is heuristic evidence, not ground truth.
