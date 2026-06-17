-- rint:migration
-- objective: allow claude as probe result provider (validation phase — Claude-only probes)
-- risk: low
-- rollback: drop claude rows, then restore check to ('chatgpt', 'gemini') only

alter table rint.results drop constraint if exists results_provider_check;

alter table rint.results add constraint results_provider_check
  check (provider in ('claude', 'chatgpt', 'gemini'));
