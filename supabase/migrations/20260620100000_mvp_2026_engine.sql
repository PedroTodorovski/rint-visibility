-- rint:migration
-- objective: MVP 2026 engine — sku cluster refs, port cache, lacuna snapshots, dual-track, gemini-only provider
-- risk: low
-- rollback: dev-only drop of new tables/columns

-- ── sku cluster: extend products to 3–5 hero refs ────────────────────────────

alter table rint.products add column if not exists external_ref text;

comment on column rint.products.external_ref is 'Shopify GID or external SKU ref — pointer only, no catalog sync';

alter table rint.products drop constraint if exists products_position;

alter table rint.products add constraint products_position check (position between 1 and 5);

comment on table rint.products is 'Hero SKU cluster refs (3–5 per store) — external pointers only';

-- ── gemini-only provider ─────────────────────────────────────────────────────

alter table rint.results drop constraint if exists results_provider_check;

alter table rint.results add constraint results_provider_check check (provider = 'gemini');

-- ── per_run_read_cache (ephemeral, scoped to probe run) ──────────────────────

create table if not exists rint.per_run_read_cache (
  id uuid primary key default gen_random_uuid(),
  probe_run_id uuid not null references rint.probe_runs (id) on delete cascade,
  port_name text not null,
  cache_key text not null,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint per_run_read_cache_unique unique (probe_run_id, port_name, cache_key)
);

comment on table rint.per_run_read_cache is 'Ephemeral read-through cache for integration ports — TTL scoped to probe run';

create index if not exists per_run_read_cache_probe_idx on rint.per_run_read_cache (probe_run_id);

alter table rint.per_run_read_cache enable row level security;

-- ── lacuna_snapshots (Conta 1 + Conta 2 separate) ────────────────────────────

create table if not exists rint.lacuna_snapshots (
  id uuid primary key default gen_random_uuid(),
  probe_run_id uuid not null references rint.probe_runs (id) on delete cascade,
  store_id uuid not null references rint.stores (id) on delete cascade,
  lacuna_rs numeric(14, 2) not null check (lacuna_rs >= 0),
  clientes_perdidos numeric(10, 2) not null check (clientes_perdidos >= 0),
  custo_compensar numeric(14, 2) not null check (custo_compensar >= 0),
  assumptions jsonb not null default '{}'::jsonb,
  flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint lacuna_snapshots_probe_run_key unique (probe_run_id)
);

comment on table rint.lacuna_snapshots is 'Derived revenue gap snapshot — Conta 1 (lacuna) and Conta 2 (custo) stored separately, never summed';
comment on column rint.lacuna_snapshots.lacuna_rs is 'Conta 1 — lacuna de receita';
comment on column rint.lacuna_snapshots.custo_compensar is 'Conta 2 — custo para compensar via mídia';

create index if not exists lacuna_snapshots_store_idx on rint.lacuna_snapshots (store_id, created_at desc);

alter table rint.lacuna_snapshots enable row level security;

-- ── dual_track_outputs ───────────────────────────────────────────────────────

create table if not exists rint.dual_track_outputs (
  id uuid primary key default gen_random_uuid(),
  probe_run_id uuid not null references rint.probe_runs (id) on delete cascade,
  sku_ref_id uuid references rint.products (id) on delete set null,
  track_number smallint not null check (track_number in (1, 2)),
  items jsonb not null default '[]'::jsonb,
  triage_owner text check (triage_owner in ('narrative', 'product_pricing')),
  created_at timestamptz not null default now(),
  constraint dual_track_outputs_unique unique (probe_run_id, sku_ref_id, track_number)
);

comment on table rint.dual_track_outputs is 'Dual-track ending — Trilha 1 (autoridade) + Trilha 2 (mídia paga) per SKU';

create index if not exists dual_track_outputs_probe_idx on rint.dual_track_outputs (probe_run_id);

alter table rint.dual_track_outputs enable row level security;

-- ── privileges ───────────────────────────────────────────────────────────────

grant select, insert, update, delete on rint.per_run_read_cache to service_role;
grant select, insert, update, delete on rint.lacuna_snapshots to service_role;
grant select, insert, update, delete on rint.dual_track_outputs to service_role;

alter default privileges in schema rint grant select, insert, update, delete on tables to service_role;
