# ADR-002 — Supabase migration ownership

**Status:** Accepted  
**Date:** 2026-06-17

## Context

Rint v1 product data lives in Supabase schema `rint`. We initially placed migrations and `Database Deploy` CI in `rint-admin` (Nowle Hub pattern: shell owns DB).

Rint differs from Nowle:

- **Nowle Hub** — shared platform DB; modules are tenants of `nowle-shell`.
- **Rint** — sellable **engine microservices**; `rint-admin` is UI/orchestration only; `rint-visibility` owns the visibility domain.

## Decision

| Concern | Owner repo |
|---------|------------|
| Supabase `rint` schema + migrations | **`rint-visibility`** |
| `db-guardrails` / `Database Deploy` workflows | **`rint-visibility`** |
| Cloudflare D1 (auth, billing, CMS) | **`rint-admin`** |
| Admin UI + HTTP proxy to engine | **`rint-admin`** |

Future sellable modules follow the same rule: **migrations live with the engine that writes the schema**.

## Consequences

- GitHub environment secrets for Supabase deploy move to **`rint-visibility`** (or stay in org-level secrets referenced by both — prefer visibility repo environments).
- `mvp-schema` and all Phase 1 SQL slices execute in **`rint-visibility`**.
- `rint-admin` docs must not instruct authors to add files under `supabase/migrations/`.

## Alternatives rejected

- **Migrations in rint-admin** — couples schema to UI releases; blocks packaging visibility as standalone product.
- **Dedicated `rint-data` repo** — valid later if multiple engines share one DB; premature for v1 single engine.
