-- rint:migration
-- objective: MVP product tables for stores, hero products, buyer prompts, probe runs, results, and weekly scores
-- risk: low
-- rollback: drop tables in reverse dependency order (dev only); prod requires forward rollback migration

-- ── stores ───────────────────────────────────────────────────────────────────

create table rint.stores (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  name text not null,
  domain text,
  locale text not null default 'en',
  status text not null default 'active' check (status in ('active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_workspace_id_key unique (workspace_id)
);

comment on table rint.stores is 'Merchant store linked to rint-app workspace_id (D1).';
comment on column rint.stores.workspace_id is 'External tenant key from rint-app D1 workspaces.id';

create index stores_status_idx on rint.stores (status);

alter table rint.stores enable row level security;

-- ── products (up to 3 hero URLs per store) ───────────────────────────────────

create table rint.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references rint.stores (id) on delete cascade,
  url text not null,
  title text,
  description text,
  position smallint not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_store_position_key unique (store_id, position),
  constraint products_store_url_key unique (store_id, url)
);

comment on table rint.products is 'Hero product URLs probed for AI visibility (max 3 per store).';

create index products_store_id_idx on rint.products (store_id);

alter table rint.products enable row level security;

-- ── prompts (5–10 buyer prompts per store) ───────────────────────────────────

create table rint.prompts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references rint.stores (id) on delete cascade,
  prompt_text text not null,
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompts_prompt_text_not_blank check (char_length(trim(prompt_text)) > 0)
);

comment on table rint.prompts is 'Buyer-intent prompts used in weekly ChatGPT/Gemini probes.';

create index prompts_store_id_active_idx on rint.prompts (store_id, active);

alter table rint.prompts enable row level security;

-- ── probe_runs (weekly batch per store) ──────────────────────────────────────

create table rint.probe_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references rint.stores (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  scheduled_for date not null default (timezone('utc', now()))::date,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  constraint probe_runs_error_when_failed check (
    status <> 'failed' or error_message is not null
  )
);

comment on table rint.probe_runs is 'One weekly visibility probe execution per store.';

create index probe_runs_store_scheduled_idx on rint.probe_runs (store_id, scheduled_for desc);
create index probe_runs_status_idx on rint.probe_runs (status);

alter table rint.probe_runs enable row level security;

-- ── results (per prompt × provider within a run) ─────────────────────────────

create table rint.results (
  id uuid primary key default gen_random_uuid(),
  probe_run_id uuid not null references rint.probe_runs (id) on delete cascade,
  prompt_id uuid not null references rint.prompts (id) on delete restrict,
  provider text not null check (provider in ('chatgpt', 'gemini')),
  cited boolean not null default false,
  response_excerpt text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint results_probe_prompt_provider_key unique (probe_run_id, prompt_id, provider)
);

comment on table rint.results is 'Raw probe outcome: was the store cited for this prompt on this provider?';

create index results_probe_run_id_idx on rint.results (probe_run_id);
create index results_prompt_id_idx on rint.results (prompt_id);

alter table rint.results enable row level security;

-- ── weekly_scores (aggregated score + catalog fixes) ─────────────────────────

create table rint.weekly_scores (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references rint.stores (id) on delete cascade,
  probe_run_id uuid references rint.probe_runs (id) on delete set null,
  week_start date not null,
  prompts_total integer not null default 0 check (prompts_total >= 0),
  citation_slots_total integer not null default 0 check (citation_slots_total >= 0),
  citations_count integer not null default 0 check (citations_count >= 0),
  score_pct numeric(5, 2) not null default 0 check (score_pct >= 0 and score_pct <= 100),
  fixes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint weekly_scores_store_week_key unique (store_id, week_start),
  constraint weekly_scores_citations_lte_slots check (citations_count <= citation_slots_total)
);

comment on table rint.weekly_scores is 'Weekly headline score: cited in X of Y buyer prompts (both providers).';
comment on column rint.weekly_scores.fixes is 'Up to 3 catalog fix suggestions (title, description, schema).';

create index weekly_scores_store_week_idx on rint.weekly_scores (store_id, week_start desc);

alter table rint.weekly_scores enable row level security;

-- ── privileges (engine uses service_role; anon/authenticated blocked by RLS) ─

revoke all on schema rint from public;
revoke all on all tables in schema rint from public;
revoke all on all sequences in schema rint from public;

grant usage on schema rint to service_role;
grant select, insert, update, delete on all tables in schema rint to service_role;
grant usage, select on all sequences in schema rint to service_role;

alter default privileges in schema rint grant select, insert, update, delete on tables to service_role;
alter default privileges in schema rint grant usage, select on sequences to service_role;
