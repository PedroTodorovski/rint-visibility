-- rint:migration
-- objective: bootstrap the rint schema as SSOT for v1 product data (stores, probes, scores)
-- risk: low
-- rollback: drop schema rint cascade (dev only; prod requires explicit maintenance window)

create schema if not exists rint;

comment on schema rint is 'Rint v1 product data: stores, hero products, buyer prompts, probe runs, weekly scores.';
