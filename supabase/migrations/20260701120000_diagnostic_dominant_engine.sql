-- rint:migration
-- objective: Full-scope Range Visibility diagnostic engine: async jobs, SKU/query evidence, dominant triage, financial risk, diagnostics, usage
-- risk: medium
-- rollback: forward migration to stop writes and drop new tables after exporting run evidence if needed

-- ── jobs: async diagnostic lifecycle ─────────────────────────────────────────

create table if not exists rint.jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references rint.stores (id) on delete cascade,
  probe_run_id uuid references rint.probe_runs (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  plan text not null default 'essential' check (plan in ('essential', 'pro')),
  webhook_url text,
  config_snapshot jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint jobs_failed_requires_error check (status <> 'failed' or error_message is not null)
);

comment on table rint.jobs is 'Async Range Visibility diagnostic jobs. Canonical job_id for polling/webhooks.';

create index if not exists jobs_store_created_idx on rint.jobs (store_id, created_at desc);
create index if not exists jobs_status_idx on rint.jobs (status);
create unique index if not exists jobs_probe_run_id_unique on rint.jobs (probe_run_id) where probe_run_id is not null;

alter table rint.jobs enable row level security;

-- ── skus: run-scoped Shopify product snapshot ────────────────────────────────

create table if not exists rint.skus (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references rint.jobs (id) on delete cascade,
  product_id uuid references rint.products (id) on delete set null,
  url text not null,
  external_ref text,
  shopify_data jsonb not null default '{}'::jsonb,
  validation_status text not null default 'valid' check (validation_status in ('valid', 'invalid')),
  validation_errors text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

comment on table rint.skus is 'Run-scoped SKU inputs and Shopify Admin product snapshot. Not a catalog warehouse.';

create index if not exists skus_job_idx on rint.skus (job_id);
create index if not exists skus_product_idx on rint.skus (product_id);

alter table rint.skus enable row level security;

-- ── queries: per SKU/query structured Gemini evidence ────────────────────────

create table if not exists rint.queries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references rint.jobs (id) on delete cascade,
  sku_id uuid not null references rint.skus (id) on delete cascade,
  prompt_id uuid references rint.prompts (id) on delete set null,
  query_text text not null,
  gemini_raw text,
  gemini_structured jsonb not null default '{}'::jsonb,
  cliente_foi_citado boolean not null default false,
  concorrente_citado_nome text,
  concorrente_citado_url text,
  atributos_mencionados_gemini text[] not null default '{}'::text[],
  temperatura_gemini numeric(4, 2) not null default 0,
  num_execucoes integer not null default 1 check (num_execucoes > 0),
  confianca text,
  executions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

comment on table rint.queries is 'Per query Gemini output after mandatory text call then structured JSON call.';

create index if not exists queries_job_idx on rint.queries (job_id);
create index if not exists queries_sku_idx on rint.queries (sku_id);
create index if not exists queries_prompt_idx on rint.queries (prompt_id);

alter table rint.queries enable row level security;

-- ── triage_results: exactly one dominant track per diagnostic ────────────────

create table if not exists rint.triage_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references rint.jobs (id) on delete cascade,
  sku_id uuid references rint.skus (id) on delete set null,
  coherence_level text not null check (coherence_level in ('coerente', 'parcialmente_coerente', 'incoerente')),
  track_assigned text not null check (track_assigned in ('track_llm', 'track_pdp', 'track_produto', 'track_midia')),
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table rint.triage_results is 'Dominant routing result. MVP rule: one track per diagnostic.';

create unique index if not exists triage_results_job_unique on rint.triage_results (job_id);
create index if not exists triage_results_track_idx on rint.triage_results (track_assigned);

alter table rint.triage_results enable row level security;

-- ── financial_risk: separated formulas and track-specific derived risks ─────

create table if not exists rint.financial_risk (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references rint.jobs (id) on delete cascade,
  sku_id uuid references rint.skus (id) on delete set null,
  gap_value numeric(14, 2),
  lost_clients numeric(12, 2),
  compensation_cost numeric(14, 2),
  formula_type text not null,
  inputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table rint.financial_risk is 'Financial risk rows. Lacuna R$ and compensation cost stay separate.';

create index if not exists financial_risk_job_idx on rint.financial_risk (job_id);
create index if not exists financial_risk_formula_idx on rint.financial_risk (formula_type);

alter table rint.financial_risk enable row level security;

-- ── diagnostics: causes/actions/next step for dominant track ────────────────

create table if not exists rint.diagnostics (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references rint.jobs (id) on delete cascade,
  sku_id uuid references rint.skus (id) on delete set null,
  track text not null check (track in ('track_llm', 'track_pdp', 'track_produto', 'track_midia')),
  causes jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  next_steps jsonb not null default '{}'::jsonb,
  prazo text not null,
  created_at timestamptz not null default now()
);

comment on table rint.diagnostics is 'Final dominant-track diagnostic. Quantification is persisted separately before recommendations.';

create unique index if not exists diagnostics_job_unique on rint.diagnostics (job_id);
create index if not exists diagnostics_track_idx on rint.diagnostics (track);

alter table rint.diagnostics enable row level security;

-- ── usage_events: future billing/audit hook ─────────────────────────────────

create table if not exists rint.usage_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references rint.jobs (id) on delete cascade,
  tokens_consumed integer not null default 0 check (tokens_consumed >= 0),
  apis_called jsonb not null default '{}'::jsonb,
  timestamp timestamptz not null default now()
);

comment on table rint.usage_events is 'Per diagnostic usage events for future billing and audit.';

create index if not exists usage_events_job_idx on rint.usage_events (job_id);
create index if not exists usage_events_timestamp_idx on rint.usage_events (timestamp desc);

alter table rint.usage_events enable row level security;

-- ── privileges ───────────────────────────────────────────────────────────────

grant select, insert, update, delete on rint.jobs to service_role;
grant select, insert, update, delete on rint.skus to service_role;
grant select, insert, update, delete on rint.queries to service_role;
grant select, insert, update, delete on rint.triage_results to service_role;
grant select, insert, update, delete on rint.financial_risk to service_role;
grant select, insert, update, delete on rint.diagnostics to service_role;
grant select, insert, update, delete on rint.usage_events to service_role;

alter default privileges in schema rint grant select, insert, update, delete on tables to service_role;
